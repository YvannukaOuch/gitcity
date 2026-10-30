import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng, type Lot, type Plan } from '@/lib/layout'
import { beamMaterial, buildingMaterial, glowMaterial, shadowMaterial, starMaterial, toonMaterial, uniforms, waterfallMaterial } from './shaders'
import { beamsGeometry, housesGeometry, islandGeometry, roofGeometry, shadowsGeometry, towersGeometry } from './build'

// Colours are used exactly as written (flat, illustrated style), no colour-space conversion.
THREE.ColorManagement.enabled = false

export const SKY = {
  night: ['#2c2577', '#171447', '#0a0924'],
  day: ['#43a9f0', '#7fcdfa', '#c4ecff'],
}

export interface SceneEvents {
  onHover: (lot: Lot | null, x: number, y: number) => void
  onSelect: (lot: Lot | null) => void
  onTimeline: (day: number, playing: boolean) => void
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Same as the shader's growth(): how far up something born on `born` has risen. */
function growthAt(born: number) {
  const g = Math.min(1, Math.max(0, (uniforms.uTimeline.value - born) / uniforms.uGrowWindow.value))
  if (g <= 0) return 0
  const k = g - 1
  return 1 + 2.5 * k * k * k + 1.5 * k * k
}

const CAR_COLORS = ['#ff5c7a', '#ffd34e', '#4fd1c5', '#ffffff', '#ff9a3c', '#7c8cff', '#5fd36b']
/** Alien flora: mushroom-capped stalks in magentas, violets and corals. */
const TREE_COLORS = ['#ff7ad9', '#b98cff', '#ff9e6b', '#8c7bff', '#ff6fa8', '#d77bff']
const SPORE_COLORS = ['#7cf7ff', '#ff8be0', '#c6ff7a']

export class CityScene {
  readonly renderer: THREE.WebGLRenderer
  private host: HTMLElement
  private events: SceneEvents
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(36, 1, 0.5, 8000)
  private controls: OrbitControls
  private city = new THREE.Group()
  private labelLayer: HTMLDivElement
  private labels: { el: HTMLDivElement; d: Plan['districts'][number]; born: number }[] = []
  private plan: Plan | null = null
  /** 'home' frames the island low on screen (room for the title) and hides district labels. */
  private framing: 'home' | 'city' = 'city'
  /** Camera distance that shows the whole island (labels fade only when you pull back past it). */
  private fitDistance = 100
  private clock = new THREE.Clock()
  private ro: ResizeObserver
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private mats = {
    towers: buildingMaterial(),
    houses: buildingMaterial(true),
    roof: toonMaterial({ vertexColors: true, grow: true, emissive: true }),
    glow: glowMaterial(),
    shadows: shadowMaterial(),
    top: toonMaterial({ vertexColors: true }),
    under: toonMaterial({ vertexColors: true, flat: true, underside: 30 }),
    roads: toonMaterial({ color: '#59638a' }),
    plazas: toonMaterial({ vertexColors: true }),
    beams: beamMaterial(),
    water: toonMaterial({ color: '#4fd8ff', unlit: true }),
    waterRim: toonMaterial({ color: '#c2f7ff', unlit: true }),
    waterfall: waterfallMaterial(),
    trunk: toonMaterial({ color: '#efe1ff' }),
    canopy: toonMaterial({ flat: true }),
    car: toonMaterial({}),
    cloud: toonMaterial({ color: '#f7f5ff', flat: true }),
    rock: toonMaterial({ flat: true, underside: 30 }),
    ring: toonMaterial({ color: '#ffffff', unlit: true, opacity: 0.9 }),
  }

  private cars: { mesh: THREE.InstancedMesh; list: { loop: number; offset: number; speed: number; dir: number; born: number }[] } | null = null
  private clouds: { mesh: THREE.InstancedMesh; list: { r: number; a: number; y: number; s: number; speed: number }[] } | null = null
  private rocks: { mesh: THREE.InstancedMesh; list: { x: number; y: number; z: number; s: number; phase: number; rot: number }[] } | null = null
  private selRing: THREE.Mesh
  private selected: Lot | null = null

  private timelineDay = 0
  private playing: { from: number; start: number; duration: number } | null = null
  private night = 1
  private nightTarget = 1
  private fly: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; start: number; duration: number } | null = null

  private pointer = { x: 0, y: 0, moved: false, inside: false, downX: 0, downY: 0, downAt: 0 }
  private hovered = -1
  private raycaster = new THREE.Raycaster()
  private disposed = false

  constructor(host: HTMLElement, events: SceneEvents) {
    this.host = host
    this.events = events
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const canvas = this.renderer.domElement
    canvas.className = 'absolute inset-0 h-full w-full touch-none outline-none'
    canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(canvas)
    this.labelLayer = document.createElement('div')
    this.labelLayer.className = 'pointer-events-none absolute inset-0 overflow-hidden'
    host.appendChild(this.labelLayer)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minPolarAngle = 0.12
    this.controls.maxPolarAngle = Math.PI * 0.6
    this.controls.autoRotateSpeed = 0.35
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false
      this.fly = null
    })

    this.scene.add(this.city)
    uniforms.uSkyLow.value.set(SKY.night[2])
    this.addSky()
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.16, 48).rotateX(-Math.PI / 2), this.mats.ring)
    this.selRing.visible = false
    this.scene.add(this.selRing)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.setAnimationLoop(this.tick)
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.ro.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.clearCity()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
    for (const m of Object.values(this.mats)) m.dispose()
    this.controls.dispose()
    this.renderer.dispose()
    canvas.remove()
    this.labelLayer.remove()
  }

  // ---------------------------------------------------------------- sky: stars and planets

  private addSky() {
    const rand = rng(7)
    const n = 1400
    const pos = new Float32Array(n * 3)
    const size = new Float32Array(n)
    const phase = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      pos.set([Math.cos(a) * s * 2600, u * 2600, Math.sin(a) * s * 2600], i * 3)
      size[i] = 1.2 + Math.pow(rand(), 3) * 3.4
      phase[i] = rand() * 10
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    this.scene.add(new THREE.Points(g, starMaterial()))

    // A big banded planet with rings, and a little moon on the other side.
    const planetGeo = new THREE.SphereGeometry(260, 64, 40)
    const bands = ['#ff9f7f', '#ffb98f', '#f2806f', '#ffc9a0', '#ff9f7f', '#e8736d']
    const col: number[] = []
    const p = planetGeo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 260
      const c = new THREE.Color(bands[Math.min(bands.length - 1, Math.floor(((y + 1) / 2) * bands.length + Math.sin(y * 9) * 0.3))])
      col.push(c.r, c.g, c.b)
    }
    planetGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const planet = new THREE.Mesh(planetGeo, toonMaterial({ vertexColors: true }))
    planet.position.set(-1500, 520, -2100)
    this.scene.add(planet)
    const ringGeo = new THREE.RingGeometry(340, 520, 120).rotateX(-Math.PI / 2 + 0.38).rotateZ(0.2)
    const ring = new THREE.Mesh(ringGeo, toonMaterial({ color: '#ffd9b8', unlit: true, opacity: 0.5, side: THREE.DoubleSide }))
    ring.position.copy(planet.position)
    this.scene.add(ring)
    const moon = new THREE.Mesh(new THREE.SphereGeometry(80, 40, 28), toonMaterial({ color: '#c9c2f2' }))
    moon.position.set(1900, 700, 900)
    this.scene.add(moon)
  }

  // ---------------------------------------------------------------- building a city

  hasPlan() {
    return !!this.plan
  }

  private clearCity() {
    this.city.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.InstancedMesh) o.geometry.dispose()
    })
    this.city.clear()
    for (const l of this.labels) l.el.remove()
    this.labels = []
    this.cars = this.clouds = this.rocks = null
    this.select(null, false)
  }

  setPlan(plan: Plan, { intro = true, framing = 'city' }: { intro?: boolean; framing?: 'home' | 'city' } = {}) {
    this.clearCity()
    this.plan = plan
    this.framing = framing
    const span = Math.max(1, plan.endDay - plan.startDay)
    uniforms.uGrowWindow.value = Math.max(2, span * 0.04)

    const add = (geometry: THREE.BufferGeometry | null, material: THREE.Material) => {
      if (!geometry) return null
      const m = new THREE.Mesh(geometry, material)
      this.city.add(m)
      return m
    }

    // Island.
    const island = islandGeometry(plan)
    ;(this.mats.under.uniforms.uDepth as { value: number }).value = island.depth
    ;(this.mats.rock.uniforms.uDepth as { value: number }).value = island.depth
    add(island.top, this.mats.top)
    add(island.under, this.mats.under)
    add(island.roads, this.mats.roads)
    add(island.plazas, this.mats.plazas)
    add(island.waterRim, this.mats.waterRim)
    add(island.water, this.mats.water)
    if (island.waterfall) {
      const w = add(island.waterfall.geometry, this.mats.waterfall)!
      w.position.set(island.waterfall.x, 0, island.waterfall.z)
      w.rotation.y = Math.PI / 2 - island.waterfall.angle
      w.renderOrder = 2
    }

    // Buildings and what's on them.
    add(shadowsGeometry(plan.lots, uniforms.uLightDir.value), this.mats.shadows)
    add(towersGeometry(plan.lots), this.mats.towers)
    add(housesGeometry(plan.lots), this.mats.houses)
    const roof = roofGeometry(plan.lots, plan.seed)
    add(roof.geometry, this.mats.roof)
    if (roof.glowGeometry) {
      const pts = new THREE.Points(roof.glowGeometry, this.mats.glow)
      pts.renderOrder = 3
      this.city.add(pts)
    }
    const beams = add(beamsGeometry(plan.lots), this.mats.beams)
    if (beams) beams.renderOrder = 4

    this.addTrees(plan)
    this.addCars(plan)
    this.addClouds(plan)
    this.addRocks(plan, island.depth)
    if (framing === 'city') this.addLabels(plan)

    // Camera and controls for this size of island.
    this.controls.minDistance = 4
    this.controls.maxDistance = plan.radius * 7 + 60
    this.fitView(false)
    this.controls.autoRotate = !this.reduced

    if (intro && !this.reduced && plan.lots.length) {
      this.setDay(plan.startDay - span * 0.02)
      this.play(Math.min(7000, 2600 + plan.lots.length * 22))
    } else this.setDay(plan.endDay)
  }

  private addTrees(plan: Plan) {
    if (!plan.trees.length) return
    // A slim stalk under a mushroom cap, with a little bulb on top.
    // Kept a little smaller than the old trees so small cities' buildings still stand out.
    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.1, 0.9, 6).translate(0, 0.45, 0)
    const cap = new THREE.SphereGeometry(0.52, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.84, 0)
    const bulb = new THREE.IcosahedronGeometry(0.13, 0).translate(0, 1.2, 0)
    cap.deleteAttribute('uv')
    bulb.deleteAttribute('uv')
    const canopyGeo = mergeGeometries([cap.toNonIndexed(), bulb])
    cap.dispose()
    bulb.dispose()
    const trunks = new THREE.InstancedMesh(trunkGeo, this.mats.trunk, plan.trees.length)
    const canopies = new THREE.InstancedMesh(canopyGeo, this.mats.canopy, plan.trees.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const c = new THREE.Color()
    const spores: number[] = []
    const sporeColors: number[] = []
    const sporeSizes: number[] = []
    plan.trees.forEach((t, i) => {
      const onPlaza = plan.districts.some((d) => t.x > d.x0 && t.x < d.x1 && t.z > d.z0 && t.z < d.z1)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.tone * 6.28)
      // Some stalks grow tall and thin, some short and squat.
      const stretch = 0.8 + ((t.tone * 7.3) % 1) * 0.6
      m.compose(new THREE.Vector3(t.x, onPlaza ? 0.07 : 0, t.z), q, new THREE.Vector3(t.s, t.s * stretch, t.s))
      trunks.setMatrixAt(i, m)
      canopies.setMatrixAt(i, m)
      c.set(TREE_COLORS[Math.floor(t.tone * 97) % TREE_COLORS.length])
      canopies.setColorAt(i, c)
      // One in four glows: a spore light hanging over its cap, brightest at night.
      if ((t.tone * 13.7) % 1 < 0.25) {
        spores.push(t.x, (onPlaza ? 0.07 : 0) + 1.2 * t.s * stretch + 0.1, t.z)
        c.set(SPORE_COLORS[Math.floor(t.tone * 31) % SPORE_COLORS.length])
        sporeColors.push(c.r, c.g, c.b)
        sporeSizes.push(0.35 + t.s * 0.25)
      }
    })
    this.city.add(trunks, canopies)
    if (spores.length) {
      const n = spores.length / 3
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(spores, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(sporeColors, 3))
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(sporeSizes, 1))
      g.setAttribute('aBorn', new THREE.Float32BufferAttribute(new Array(n).fill(-1e9), 1))
      g.setAttribute('aPhase', new THREE.Float32BufferAttribute(Array.from({ length: n }, (_, i) => i * 2.3), 1))
      const pts = new THREE.Points(g, this.mats.glow)
      pts.renderOrder = 3
      this.city.add(pts)
    }
  }

  private addCars(plan: Plan) {
    const rand = rng(plan.seed ^ 0xca5)
    const list: NonNullable<CityScene['cars']>['list'] = []
    plan.carLoops.forEach((loop, i) => {
      const per = 2 * (loop.x1 - loop.x0 + (loop.z1 - loop.z0))
      const n = Math.max(1, Math.min(4, Math.round(per / 18)))
      const lots = plan.lots.filter((l) => l.district === i)
      const born = lots.length ? Math.min(...lots.map((l) => l.born)) : plan.startDay
      for (let k = 0; k < n && list.length < 80; k++) list.push({ loop: i, offset: (k / n + rand() * 0.1) * per, speed: 2.2 + rand() * 1.4, dir: rand() < 0.5 ? 1 : -1, born })
    })
    if (!list.length) return
    // Hover saucers instead of cars: a flat disc with a little bubble cockpit.
    const body = new THREE.SphereGeometry(0.42, 18, 8).scale(1, 0.32, 1)
    const cabin = new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.08, 0)
    body.deleteAttribute('uv')
    cabin.deleteAttribute('uv')
    const geo = mergeGeometries([body, cabin])
    body.dispose()
    cabin.dispose()
    const mesh = new THREE.InstancedMesh(geo, this.mats.car, list.length)
    const c = new THREE.Color()
    list.forEach((_, i) => mesh.setColorAt(i, c.set(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)])))
    mesh.frustumCulled = false
    this.city.add(mesh)
    this.cars = { mesh, list }
  }

  private addClouds(plan: Plan) {
    const rand = rng(plan.seed ^ 0xc10d)
    const puffs = [
      [0, 0, 0, 1],
      [0.95, -0.18, 0.1, 0.72],
      [-0.95, -0.22, -0.08, 0.68],
      [0.38, 0.38, -0.25, 0.66],
      [-0.42, 0.3, 0.28, 0.6],
    ].map(([x, y, z, s]) => new THREE.IcosahedronGeometry(s, 1).scale(1, 0.82, 1).translate(x, y, z))
    const geo = mergeGeometries(puffs)
    puffs.forEach((p) => p.dispose())
    const n = Math.max(4, Math.min(10, Math.round(plan.radius / 4)))
    // Clouds drift round the rim at about ground level, below the line of sight to the city, so
    // they frame the island instead of covering buildings.
    const clear = Math.max(plan.radius * 1.08, plan.cityRadius + 4)
    const list = Array.from({ length: n }, () => ({
      r: clear + plan.radius * rand() * 0.35,
      a: rand() * Math.PI * 2,
      y: -1.5 + rand() * 3,
      s: 1.1 + rand() * 1.5 + plan.radius * 0.02,
      speed: (0.012 + rand() * 0.02) * (rand() < 0.5 ? 1 : -1),
    }))
    const mesh = new THREE.InstancedMesh(geo, this.mats.cloud, n)
    mesh.frustumCulled = false
    this.city.add(mesh)
    this.clouds = { mesh, list }
  }

  private addRocks(plan: Plan, depth: number) {
    const rand = rng(plan.seed ^ 0x40c)
    const n = 9
    const list = Array.from({ length: n }, () => {
      const a = rand() * Math.PI * 2
      const r = plan.radius * (1.04 + rand() * 0.3)
      return { x: Math.cos(a) * r, y: -depth * (0.12 + rand() * 0.45), z: Math.sin(a) * r, s: 0.5 + rand() * (0.6 + plan.radius * 0.03), phase: rand() * 6.28, rot: rand() * 6.28 }
    })
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.mats.rock, n)
    const c = new THREE.Color()
    list.forEach((_, i) => mesh.setColorAt(i, c.set(i % 3 ? '#7d567d' : '#9a6550')))
    mesh.frustumCulled = false
    this.city.add(mesh)
    this.rocks = { mesh, list }
  }

  private addLabels(plan: Plan) {
    for (const [i, d] of plan.districts.entries()) {
      const el = document.createElement('div')
      el.className = 'absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#1b1546]/85 px-2.5 py-1 text-xs font-semibold text-white shadow-md ring-1 ring-white/15 transition-opacity duration-300'
      const dot = document.createElement('span')
      dot.className = 'size-2.5 rounded-full'
      dot.style.background = d.color
      const text = document.createElement('span')
      text.textContent = `${d.name} · ${d.count}`
      el.append(dot, text)
      el.style.opacity = '0'
      this.labelLayer.appendChild(el)
      const lots = plan.lots.filter((l) => l.district === i)
      this.labels.push({ el, d, born: lots.length ? Math.min(...lots.map((l) => l.born)) : plan.startDay })
    }
  }

  // ---------------------------------------------------------------- view

  private resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    uniforms.uPixelRatio.value = dpr
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Frame the whole island. */
  fitView(animate = true) {
    const plan = this.plan
    if (!plan) return
    const fov = (this.camera.fov * Math.PI) / 180
    const aspect = this.camera.aspect
    let dist = (plan.radius * 1.18) / Math.tan(fov / 2)
    if (aspect < 1) dist /= Math.pow(aspect, 0.85)
    this.fitDistance = dist
    const tallest = plan.lots.reduce((m, l) => Math.max(m, l.h), 2)
    const target = new THREE.Vector3(0, Math.min(tallest * 0.25, plan.radius * 0.2) - plan.radius * 0.08 + (this.framing === 'home' ? plan.radius * 0.42 : 0), 0)
    const dir = new THREE.Vector3().setFromSphericalCoords(1, 1.02, 0.62)
    const pos = target.clone().addScaledVector(dir, dist)
    if (animate) this.flyTo(target, pos)
    else {
      this.controls.target.copy(target)
      this.camera.position.copy(pos)
      this.controls.update()
    }
  }

  private flyTo(target: THREE.Vector3, pos: THREE.Vector3, duration = 900) {
    this.fly = { fromT: this.controls.target.clone(), toT: target, fromP: this.camera.position.clone(), toP: pos, start: performance.now(), duration: this.reduced ? 1 : duration }
  }

  setNight(night: boolean) {
    this.nightTarget = night ? 1 : 0
  }

  // ---------------------------------------------------------------- timeline

  /** Show the city as it was on a day (days since 1970). */
  setDay(d: number) {
    const plan = this.plan
    if (!plan) return
    this.timelineDay = d
    const span = Math.max(1, plan.endDay - plan.startDay)
    const k = Math.min(1, Math.max(0, (d - plan.startDay) / span))
    // At the end everything has finished growing, however new.
    uniforms.uTimeline.value = d + uniforms.uGrowWindow.value * k
  }

  play(duration?: number) {
    const plan = this.plan
    if (!plan) return
    let from = this.timelineDay
    if (from >= plan.endDay - 0.5) from = plan.startDay - (plan.endDay - plan.startDay) * 0.02
    const ms = duration ?? Math.min(9000, 3000 + plan.lots.length * 25)
    const total = plan.endDay - from
    const span = plan.endDay - plan.startDay + 1e-6
    this.playing = { from, start: performance.now(), duration: Math.max(800, ms * (total / span)) }
  }

  pause() {
    if (!this.playing) return
    this.playing = null
    this.events.onTimeline(this.timelineDay, false)
  }

  // ---------------------------------------------------------------- picking

  private onPointerMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = e.clientX - r.left
    this.pointer.y = e.clientY - r.top
    this.pointer.moved = true
    this.pointer.inside = true
  }
  private onPointerLeave = () => {
    this.pointer.inside = false
    this.setHover(-1)
  }
  private onPointerDown = (e: PointerEvent) => {
    this.pointer.downX = e.clientX
    this.pointer.downY = e.clientY
    this.pointer.downAt = performance.now()
  }
  private onPointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY) > 6 || performance.now() - this.pointer.downAt > 600) return
    const r = this.renderer.domElement.getBoundingClientRect()
    const id = this.pick(e.clientX - r.left, e.clientY - r.top)
    const lot = id >= 0 ? this.plan!.lots[id] : null
    this.select(lot)
    this.events.onSelect(lot)
  }

  private pick(x: number, y: number) {
    const plan = this.plan
    if (!plan) return -1
    const w = this.renderer.domElement.clientWidth
    const h = this.renderer.domElement.clientHeight
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera)
    const ray = this.raycaster.ray
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = -1
    let bestDist = Infinity
    plan.lots.forEach((lot, i) => {
      const g = growthAt(lot.born)
      if (g < 0.05) return
      box.min.set(lot.x - lot.w / 2, 0, lot.z - lot.d / 2)
      box.max.set(lot.x + lot.w / 2, lot.h * g + (lot.repo.stars ? 0.6 : 0), lot.z + lot.d / 2)
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceTo(ray.origin)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
    })
    return best
  }

  private setHover(id: number) {
    if (id === this.hovered) return
    this.hovered = id
    uniforms.uHover.value = id
    this.renderer.domElement.style.cursor = id >= 0 ? 'pointer' : 'grab'
    if (id < 0) this.events.onHover(null, 0, 0)
  }

  /** Pick a building (or nothing); flies to it. */
  select(lot: Lot | null, fly = true) {
    this.selected = lot
    const id = lot && this.plan ? this.plan.lots.indexOf(lot) : -1
    uniforms.uSelected.value = id
    this.selRing.visible = !!lot
    if (!lot) return
    this.selRing.position.set(lot.x, 0.1, lot.z)
    const s = Math.max(lot.w, lot.d) * 0.86
    this.selRing.scale.set(s, 1, s)
    if (fly) {
      this.controls.autoRotate = false
      const target = new THREE.Vector3(lot.x, lot.h * 0.45, lot.z)
      const dir = this.camera.position.clone().sub(this.controls.target).normalize()
      const dist = Math.min(Math.max(lot.h * 2.6, 13), this.controls.maxDistance)
      this.flyTo(target, target.clone().addScaledVector(dir, dist))
    }
  }

  // ---------------------------------------------------------------- every frame

  private tick = () => {
    if (this.disposed) return
    const dt = Math.min(0.05, this.clock.getDelta())
    const time = (uniforms.uTime.value += dt)
    const plan = this.plan

    // Day ↔ night.
    if (this.night !== this.nightTarget) {
      this.night += Math.sign(this.nightTarget - this.night) * Math.min(Math.abs(this.nightTarget - this.night), dt * 1.6)
      uniforms.uNight.value = this.night
      const sky = new THREE.Color(SKY.night[2]).lerp(new THREE.Color(SKY.day[2]), 1 - this.night)
      uniforms.uSkyLow.value.copy(sky)
    }

    // Time-lapse.
    if (this.playing && plan) {
      const k = Math.min(1, (performance.now() - this.playing.start) / this.playing.duration)
      this.setDay(this.playing.from + (plan.endDay - this.playing.from) * k)
      if (k >= 1) this.playing = null
      this.events.onTimeline(this.timelineDay, !!this.playing)
    }

    // Camera flights.
    if (this.fly) {
      const k = Math.min(1, (performance.now() - this.fly.start) / this.fly.duration)
      const e = ease(k)
      this.controls.target.lerpVectors(this.fly.fromT, this.fly.toT, e)
      this.camera.position.lerpVectors(this.fly.fromP, this.fly.toP, e)
      if (k >= 1) this.fly = null
    }
    if (plan) {
      // Don't let panning wander off into space.
      const t = this.controls.target
      const r = Math.hypot(t.x, t.z)
      if (r > plan.radius) t.multiplyScalar(plan.radius / r)
      t.y = Math.max(-plan.radius * 0.5, Math.min(t.y, Math.max(40, plan.radius)))
    }
    this.controls.update()

    if (plan) this.animateLife(time)
    if (this.selRing.visible) {
      const p = 1 + Math.sin(time * 3) * 0.04
      const s = Math.max(this.selected!.w, this.selected!.d) * 0.86 * p
      this.selRing.scale.set(s, 1, s)
    }

    // Hover (at most once a frame).
    if (this.pointer.moved && this.pointer.inside && plan) {
      this.pointer.moved = false
      const id = this.pick(this.pointer.x, this.pointer.y)
      this.setHover(id)
      if (id >= 0) {
        const r = this.renderer.domElement.getBoundingClientRect()
        this.events.onHover(plan.lots[id], this.pointer.x + r.left, this.pointer.y + r.top)
      }
    }

    this.renderer.render(this.scene, this.camera)
    this.updateLabels()
  }

  private animateLife(time: number) {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const v = new THREE.Vector3()
    const s = new THREE.Vector3()
    const plan = this.plan!

    if (this.cars) {
      const { mesh, list } = this.cars
      const at = (loop: Plan['carLoops'][number], dist: number, out: THREE.Vector3) => {
        const w = loop.x1 - loop.x0
        const h = loop.z1 - loop.z0
        const per = 2 * (w + h)
        let d = ((dist % per) + per) % per
        if (d < w) return out.set(loop.x0 + d, 0, loop.z0)
        d -= w
        if (d < h) return out.set(loop.x1, 0, loop.z0 + d)
        d -= h
        if (d < w) return out.set(loop.x1 - d, 0, loop.z1)
        d -= w
        return out.set(loop.x0, 0, loop.z1 - d)
      }
      const ahead = new THREE.Vector3()
      const behind = new THREE.Vector3()
      list.forEach((c, i) => {
        const loop = plan.carLoops[c.loop]
        const dist = c.offset + c.dir * c.speed * time
        at(loop, dist, v)
        at(loop, dist + c.dir * 0.6, ahead)
        at(loop, dist - c.dir * 0.6, behind)
        const heading = Math.atan2(-(ahead.z - behind.z), ahead.x - behind.x)
        q.setFromAxisAngle(up, heading)
        const show = growthAt(c.born) > 0.5 ? 1 : 0
        const hover = 0.55 + Math.sin(time * 2.4 + i * 1.3) * 0.08
        m.compose(v.set((ahead.x + behind.x) / 2, hover, (ahead.z + behind.z) / 2), q, s.set(show, show, show))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }

    if (this.clouds) {
      const { mesh, list } = this.clouds
      list.forEach((c, i) => {
        const a = c.a + c.speed * time
        q.setFromAxisAngle(up, -a)
        m.compose(v.set(Math.cos(a) * c.r, c.y + Math.sin(time * 0.4 + i) * 0.3, Math.sin(a) * c.r), q, s.set(c.s, c.s, c.s))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }

    if (this.rocks) {
      const { mesh, list } = this.rocks
      list.forEach((r, i) => {
        q.setFromAxisAngle(up, r.rot + time * 0.1)
        m.compose(v.set(r.x, r.y + Math.sin(time * 0.6 + r.phase) * 0.5, r.z), q, s.set(r.s, r.s * 0.8, r.s))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  private updateLabels() {
    if (!this.labels.length) return
    const w = this.renderer.domElement.clientWidth
    const h = this.renderer.domElement.clientHeight
    const cam = this.camera.position
    const v = new THREE.Vector3()
    const far = this.camera.position.distanceTo(this.controls.target)
    const zoomFade = Math.min(1, Math.max(0, 2.2 - far / this.fitDistance))
    for (const l of this.labels) {
      const d = l.d
      // Stand the label on whichever side of the district faces the camera.
      const cx = (d.x0 + d.x1) / 2
      const cz = (d.z0 + d.z1) / 2
      const dx = cam.x - cx
      const dz = cam.z - cz
      if (Math.abs(dx) * (d.z1 - d.z0) > Math.abs(dz) * (d.x1 - d.x0)) v.set(dx > 0 ? d.x1 : d.x0, 0.3, cz)
      else v.set(cx, 0.3, dz > 0 ? d.z1 : d.z0)
      v.project(this.camera)
      const visible = v.z < 1 && growthAt(l.born) > 0.3
      l.el.style.opacity = visible ? String(zoomFade) : '0'
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`
    }
  }

  // ---------------------------------------------------------------- picture

  /** The city as a PNG, sky and all. */
  async snapshot(caption: string): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera)
    const src = this.renderer.domElement
    const out = document.createElement('canvas')
    out.width = src.width
    out.height = src.height
    const g = out.getContext('2d')!
    const stops = this.nightTarget ? SKY.night : SKY.day
    const grad = g.createLinearGradient(0, 0, 0, out.height)
    grad.addColorStop(0, stops[0])
    grad.addColorStop(0.55, stops[1])
    grad.addColorStop(1, stops[2])
    g.fillStyle = grad
    g.fillRect(0, 0, out.width, out.height)
    g.drawImage(src, 0, 0)
    const scale = out.width / src.clientWidth
    g.font = `600 ${Math.round(15 * scale)}px Fredoka Variable, Nunito Variable, sans-serif`
    g.fillStyle = 'rgba(255, 255, 255, 0.85)'
    g.textAlign = 'right'
    g.fillText(caption, out.width - 18 * scale, out.height - 18 * scale)
    return new Promise((res) => out.toBlob(res, 'image/png'))
  }
}
