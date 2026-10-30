import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD, rimRadius, rng, type Lot, type Plan } from '@/lib/layout'

/** Geometry for a city plan. Each part is merged into as few meshes as possible, so drawing stays cheap. */

const color = (hex: string) => new THREE.Color(hex)

function fill(n: number, values: number[]) {
  const a = new Float32Array(n * values.length)
  for (let i = 0; i < n; i++) a.set(values, i * values.length)
  return a
}

function paint(g: THREE.BufferGeometry, hex: string | THREE.Color) {
  const c = typeof hex === 'string' ? color(hex) : hex
  g.setAttribute('color', new THREE.BufferAttribute(fill(g.attributes.position.count, [c.r, c.g, c.b]), 3))
  return g
}

function setFloat(g: THREE.BufferGeometry, name: string, value: number) {
  g.setAttribute(name, new THREE.BufferAttribute(fill(g.attributes.position.count, [value]), 1))
  return g
}

const merge = (list: THREE.BufferGeometry[]) => {
  if (!list.length) return null
  const m = mergeGeometries(list)
  for (const g of list) g.dispose()
  return m
}

// ------------------------------------------------------------------ buildings (an alien city)

/** Glow colours of the alien city: portholes, energy rings, halos and construction holograms. */
export const ACCENTS = ['#5ff6ff', '#ff6bd6', '#b6ff6a', '#ffcf5c', '#a98bff']
const seedOf = (id: number) => (id * 0.6180339) % 1
export const accentOf = (id: number) => ACCENTS[Math.floor(seedOf(id) * ACCENTS.length) % ACCENTS.length]

function lotAttributes(g: THREE.BufferGeometry, lot: Lot, id: number, local: Float32Array) {
  const c = color(lot.color)
  const a = color(accentOf(id))
  const n = g.attributes.position.count
  g.setAttribute('aLocal', new THREE.BufferAttribute(local, 3))
  g.setAttribute('aBase', new THREE.BufferAttribute(fill(n, [c.r, c.g, c.b]), 3))
  g.setAttribute('aAccent', new THREE.BufferAttribute(fill(n, [a.r, a.g, a.b]), 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(fill(n, [lot.w, lot.h, lot.d]), 3))
  g.setAttribute('aInfo', new THREE.BufferAttribute(fill(n, [lot.lit, lot.born, seedOf(id)]), 3))
  g.setAttribute('aId', new THREE.BufferAttribute(fill(n, [id]), 1))
}

const V2 = (x: number, y: number) => new THREE.Vector2(Math.max(0, x), y)

/** Quarter-ellipse from (r, y0) up and in to the axis at y1: a dome. */
function domeArc(r: number, y0: number, y1: number, steps = 6) {
  const pts: THREE.Vector2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2)
    pts.push(V2(r * Math.cos(t), y0 + (y1 - y0) * Math.sin(t)))
  }
  return pts
}

/**
 * The silhouette (radius by height) of an alien tower, turned on a lathe. Four species, picked by
 * the repo: a spire with a seed pod, a mushroom tower, a stack of saucers and a capsule. Small
 * repos are always capsules so they still read as buildings.
 */
export function towerProfile(r: number, h: number, seed: number) {
  const kind = h < 1.8 ? 3 : Math.floor(seed * 4) % 4
  if (kind === 0) {
    // Spire: flared foot, slim stem, a fat pod, then a needle.
    const pod: THREE.Vector2[] = []
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + (i / 8) * Math.PI
      pod.push(V2(r * (0.55 + 0.45 * Math.cos(t)), h * (0.66 + 0.2 * Math.sin(t))))
    }
    return [V2(r * 1.02, 0), V2(r * 0.95, h * 0.05), V2(r * 0.6, h * 0.22), V2(r * 0.52, h * 0.4), ...pod, V2(r * 0.3, h * 0.9), V2(r * 0.12, h * 0.96), V2(0, h)]
  }
  if (kind === 1) {
    // Mushroom: a stem with a wide cap.
    return [V2(r * 0.72, 0), V2(r * 0.5, h * 0.12), V2(r * 0.46, h * 0.66), V2(r * 1.12, h * 0.72), V2(r * 1.08, h * 0.79), ...domeArc(r * 1.08, h * 0.79, h)]
  }
  if (kind === 2) {
    // A stack of saucers on a core.
    const n = Math.max(2, Math.round(h / 2.2))
    const seg = h / n
    const pts = [V2(r * 0.55, 0)]
    for (let i = 0; i < n; i++) {
      const y = i * seg
      pts.push(V2(r * 0.55, y + seg * 0.18), V2(r * 1.05, y + seg * 0.42), V2(r * 1.0, y + seg * 0.56), V2(r * 0.55, y + seg * 0.8))
    }
    return [...pts, ...domeArc(r * 0.55, h - seg * 0.2, h, 4)]
  }
  // Capsule.
  return [V2(r * 0.96, 0), V2(r, h * 0.2), V2(r * 0.98, h * 0.55), ...domeArc(r * 0.98, h * 0.55, h)]
}

/** Towers: lathe-turned alien buildings at their real proportions. */
export function towersGeometry(lots: Lot[]) {
  const parts: THREE.BufferGeometry[] = []
  lots.forEach((lot, id) => {
    if (lot.kind !== 'tower') return
    const r = Math.min(lot.w, lot.d) * 0.46
    const g = new THREE.LatheGeometry(towerProfile(r, lot.h, seedOf(id * 7 + 3)), 22)
    const local = new Float32Array(g.attributes.position.array)
    g.translate(lot.x, 0, lot.z)
    g.deleteAttribute('uv')
    lotAttributes(g, lot, id, local)
    parts.push(g)
  })
  return merge(parts)
}

let houseUnit: THREE.BufferGeometry | null = null
/** A little dome pod with a glowing cap, 1 × 1 × 1. */
function houseGeometry() {
  if (houseUnit) return houseUnit
  const g = new THREE.LatheGeometry([V2(0.5, 0), V2(0.5, 0.18), ...domeArc(0.5, 0.18, 1, 8)], 18)
  g.deleteAttribute('uv')
  const p = g.attributes.position
  const roof = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) roof[i] = p.getY(i) > 0.8 ? 1 : 0
  g.setAttribute('aRoof', new THREE.BufferAttribute(roof, 1))
  houseUnit = g
  return houseUnit
}

/** Forks: little dome pods. */
export function housesGeometry(lots: Lot[]) {
  const parts: THREE.BufferGeometry[] = []
  lots.forEach((lot, id) => {
    if (lot.kind !== 'house') return
    const g = houseGeometry().clone()
    g.scale(lot.w, lot.h, lot.d)
    const local = new Float32Array(g.attributes.position.array)
    g.translate(lot.x, 0, lot.z)
    lotAttributes(g, lot, id, local)
    parts.push(g)
  })
  return merge(parts)
}

/** Floating halo rings round tall towers and, for starred repos, an antenna with a beacon. */
export function roofGeometry(lots: Lot[], _seed: number) {
  const parts: THREE.BufferGeometry[] = []
  const glows: { x: number; y: number; z: number; size: number; born: number }[] = []
  const add = (g: THREE.BufferGeometry, hex: string | THREE.Color, born: number, glow = 0) => {
    g.deleteAttribute('uv')
    paint(g, hex)
    setFloat(g, 'aBorn', born)
    setFloat(g, 'aGlow', glow)
    parts.push(g)
  }
  lots.forEach((lot, id) => {
    if (lot.kind !== 'tower') return
    const top = lot.h
    const r = Math.min(lot.w, lot.d) * 0.46
    if (lot.h > 3) {
      const halo = new THREE.TorusGeometry(r * 1.45, 0.05, 6, 40).rotateX(Math.PI / 2 + (seedOf(id) - 0.5) * 0.35)
      add(halo.translate(lot.x, lot.h * 0.5, lot.z), accentOf(id), lot.born, 1)
    }
    if (lot.repo.stars > 0) {
      const mast = 0.5 + 0.28 * Math.log10(1 + lot.repo.stars)
      const ball = 0.11 + 0.05 * Math.log10(1 + lot.repo.stars)
      add(new THREE.CylinderGeometry(0.03, 0.05, mast, 6).translate(lot.x, top + mast / 2 - 0.05, lot.z), '#ebe8f8', lot.born)
      add(new THREE.SphereGeometry(ball, 12, 8).translate(lot.x, top + mast + ball * 0.6, lot.z), '#7cf7ff', lot.born, 1)
      glows.push({ x: lot.x, y: top + mast + ball * 0.6, z: lot.z, size: 0.7 + 0.45 * Math.log10(1 + lot.repo.stars), born: lot.born })
    }
  })
  const geometry = merge(parts)
  let glowGeometry: THREE.BufferGeometry | null = null
  if (glows.length) {
    glowGeometry = new THREE.BufferGeometry()
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glows.flatMap((g) => [g.x, g.y, g.z])), 3))
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(fill(glows.length, [0.49, 0.97, 1]), 3))
    glowGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(glows.map((g) => g.size)), 1))
    glowGeometry.setAttribute('aBorn', new THREE.BufferAttribute(new Float32Array(glows.map((g) => g.born)), 1))
    glowGeometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(glows.map((_, i) => i * 1.7)), 1))
  }
  return { geometry, glowGeometry }
}

/** Soft shadows on the ground, stretched away from the light. */
export function shadowsGeometry(lots: Lot[], light: THREE.Vector3) {
  const dir = new THREE.Vector2(-light.x, -light.z).normalize()
  const parts: THREE.BufferGeometry[] = []
  for (const lot of lots) {
    const size = Math.max(lot.w, lot.d)
    const len = size * 1.35 + lot.h * 0.32
    const g = new THREE.PlaneGeometry(len, size * 1.45).rotateX(-Math.PI / 2)
    g.rotateY(-Math.atan2(dir.y, dir.x))
    g.translate(lot.x + dir.x * (len / 2 - size * 0.45), 0.09, lot.z + dir.y * (len / 2 - size * 0.45))
    setFloat(g, 'aBorn', lot.born)
    g.deleteAttribute('normal')
    parts.push(g)
  }
  return merge(parts)
}

/**
 * Construction beams: an open cylinder of light over every building, shown only while it is being
 * built (the shader hides it before and after), like the city is beamed down from orbit.
 */
export function beamsGeometry(lots: Lot[]) {
  const parts: THREE.BufferGeometry[] = []
  for (const lot of lots) {
    const r = Math.min(lot.w, lot.d) * 0.62
    const H = lot.h + 9
    const g = new THREE.CylinderGeometry(r * 0.8, r, H, 24, 1, true).translate(lot.x, H / 2, lot.z)
    g.deleteAttribute('normal')
    setFloat(g, 'aBorn', lot.born)
    parts.push(g)
  }
  return merge(parts)
}

// ------------------------------------------------------------------ the island

function roundedRect(x0: number, z0: number, x1: number, z1: number, r: number, y: number) {
  const rr = Math.min(r, (x1 - x0) / 2, (z1 - z0) / 2)
  const s = new THREE.Shape()
  // Shapes are drawn in x/y; turned flat, y becomes -z.
  const a = { x0, x1, y0: -z1, y1: -z0 }
  s.moveTo(a.x0 + rr, a.y0)
  s.lineTo(a.x1 - rr, a.y0)
  s.quadraticCurveTo(a.x1, a.y0, a.x1, a.y0 + rr)
  s.lineTo(a.x1, a.y1 - rr)
  s.quadraticCurveTo(a.x1, a.y1, a.x1 - rr, a.y1)
  s.lineTo(a.x0 + rr, a.y1)
  s.quadraticCurveTo(a.x0, a.y1, a.x0, a.y1 - rr)
  s.lineTo(a.x0, a.y0 + rr)
  s.quadraticCurveTo(a.x0, a.y0, a.x0 + rr, a.y0)
  const g = new THREE.ShapeGeometry(s, 5).rotateX(-Math.PI / 2).translate(0, y, 0)
  g.deleteAttribute('uv')
  return g
}

export interface IslandParts {
  top: THREE.BufferGeometry
  under: THREE.BufferGeometry
  depth: number
  roads: THREE.BufferGeometry | null
  plazas: THREE.BufferGeometry | null
  water: THREE.BufferGeometry | null
  waterRim: THREE.BufferGeometry | null
  waterfall: { geometry: THREE.BufferGeometry; x: number; z: number; angle: number } | null
}

export function islandGeometry(plan: Plan): IslandParts {
  const rand = rng(plan.seed ^ 0x1a1a)
  const R = plan.radius
  const SEG = 120
  const rim = (a: number) => rimRadius(plan, a)

  // Alien moss on top: a disc, a little lighter in the middle.
  const top = new THREE.BufferGeometry()
  {
    const rings = [0, 0.45, 0.8, 0.94, 1]
    const tones = ['#6fdcc6', '#66d3be', '#5ac6b3', '#4fb9a8', '#45ac9e']
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    rings.forEach((f, ri) => {
      const c = color(tones[ri])
      for (let s = 0; s < (ri === 0 ? 1 : SEG); s++) {
        const a = (s / SEG) * Math.PI * 2
        const r = rim(a) * f
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
        col.push(c.r, c.g, c.b)
      }
    })
    const start = (ri: number) => (ri === 0 ? 0 : 1 + (ri - 1) * SEG)
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s)
    for (let ri = 1; ri < rings.length - 1; ri++) {
      const a = start(ri)
      const b = start(ri + 1)
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG
        idx.push(a + s, a + s1, b + s, a + s1, b + s1, b + s)
      }
    }
    top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    top.setIndex(idx)
    top.computeVertexNormals()
  }

  // Underneath: a grass lip, then layers of soil and rock narrowing to a point.
  const depth = R * 0.95 + 4
  const under = new THREE.BufferGeometry()
  {
    const UNDER_SEG = 56
    const layers = [
      { y: 0, f: 1, c: '#40a596' },
      { y: -0.55, f: 1.0, c: '#358f84' },
      { y: -0.6, f: 0.985, c: '#b07a55' },
      { y: -depth * 0.2, f: 0.9, c: '#9a6550' },
      { y: -depth * 0.42, f: 0.7, c: '#7d567d' },
      { y: -depth * 0.68, f: 0.42, c: '#5f4a86' },
      { y: -depth * 0.88, f: 0.16, c: '#4a3d78' },
      { y: -depth, f: 0, c: '#3d3268' },
    ]
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    layers.forEach((L, li) => {
      const c = color(L.c)
      for (let s = 0; s < UNDER_SEG; s++) {
        const a = (s / UNDER_SEG) * Math.PI * 2
        const jitter = li >= 3 ? 1 + (rand() - 0.5) * 0.16 : 1
        const r = rim(a) * L.f * jitter
        const y = L.y + (li >= 3 && li < layers.length - 1 ? (rand() - 0.5) * depth * 0.05 : 0)
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r)
        col.push(c.r, c.g, c.b)
      }
    })
    for (let li = 0; li < layers.length - 1; li++) {
      const a = li * UNDER_SEG
      const b = (li + 1) * UNDER_SEG
      for (let s = 0; s < UNDER_SEG; s++) {
        const s1 = (s + 1) % UNDER_SEG
        idx.push(a + s, a + s1, b + s, a + s1, b + s1, b + s)
      }
    }
    under.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    under.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    under.setIndex(idx)
    under.computeVertexNormals()
  }

  // Roads round every district, and the plazas the buildings stand on.
  const roads = merge(plan.districts.map((d) => roundedRect(d.x0 - ROAD / 2 - 0.2, d.z0 - ROAD / 2 - 0.2, d.x1 + ROAD / 2 + 0.2, d.z1 + ROAD / 2 + 0.2, 1.4, 0.03)))
  const plazas = merge(
    plan.districts.map((d) => paint(roundedRect(d.x0, d.z0, d.x1, d.z1, 0.9, 0.07), color('#e9e6f7').lerp(color(d.color), 0.16))),
  )

  // A lake with a stream to the edge, and the waterfall it pours over.
  let water: THREE.BufferGeometry | null = null
  let waterRim: THREE.BufferGeometry | null = null
  let waterfall: IslandParts['waterfall'] = null
  if (plan.lake) {
    const L = plan.lake
    const edge = rim(L.angle)
    const dist = Math.hypot(L.x, L.z)
    const streamLen = edge - dist + 0.4
    const streamW = L.r * 0.7
    const stream = (w: number, y: number, extra: number) =>
      new THREE.PlaneGeometry(streamLen + extra, w).rotateX(-Math.PI / 2).translate(streamLen / 2 + extra / 2, y, 0).rotateY(-L.angle).translate(L.x, 0, L.z)
    const lake = (r: number, y: number) => new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2).translate(L.x, y, L.z)
    water = merge([lake(L.r, 0.06), stream(streamW, 0.06, 0)].map((g) => (g.deleteAttribute('uv'), g)))
    waterRim = merge([lake(L.r + 0.45, 0.045), stream(streamW + 0.9, 0.045, -0.3)].map((g) => (g.deleteAttribute('uv'), g)))
    const fallH = depth * 0.85
    const fall = new THREE.PlaneGeometry(streamW, fallH, 1, 12)
    // Curve the bottom outward a little, like water arcing off a ledge.
    const p = fall.attributes.position
    for (let i = 0; i < p.count; i++) {
      const t = (fallH / 2 - p.getY(i)) / fallH
      p.setZ(i, t * t * fallH * 0.12)
    }
    fall.translate(0, -fallH / 2 + 0.02, 0)
    waterfall = { geometry: fall, x: Math.cos(L.angle) * (edge - 0.05), z: Math.sin(L.angle) * (edge - 0.05), angle: L.angle }
  }

  return { top, under, depth, roads, plazas, water, waterRim, waterfall }
}
