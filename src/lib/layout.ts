import type { Repo } from '@/lib/github'
import { languageColor, NO_LANGUAGE } from '@/lib/languages'

/**
 * Turns a list of repos into a city plan: one district per language (tallest towers in the middle),
 * roads between districts, parks and trees around them, and an island big enough to hold it all.
 * Everything is seeded by the username, so the same person always gets the same city.
 */

export interface Lot {
  repo: Repo
  kind: 'tower' | 'house'
  x: number
  z: number
  w: number
  d: number
  /** Full height (towers: from repo size). */
  h: number
  color: string
  /** Share of windows lit (recent activity). */
  lit: number
  /** Day the repo was created (days since 1970), for the time-lapse. */
  born: number
  district: number
}

export interface District {
  name: string
  color: string
  count: number
  /** The plaza the buildings stand on. */
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface Plan {
  lots: Lot[]
  districts: District[]
  /** Island radius. */
  radius: number
  /** How far out the city reaches. */
  cityRadius: number
  trees: { x: number; z: number; s: number; tone: number }[]
  lake: { x: number; z: number; r: number; angle: number } | null
  carLoops: { x0: number; z0: number; x1: number; z1: number }[]
  startDay: number
  endDay: number
  seed: number
}

export const CELL = 3
const PAD = 0.6
/** Road between districts. */
export const ROAD = 2.6
const MAX_DISTRICTS = 14

export const day = (iso: string) => new Date(iso).getTime() / 86400_000

/** Height from repo size (KB): doubles of size add about a storey. */
export const heightFromSize = (kb: number) => 0.8 + 0.9 * Math.log2(1 + kb / 4)

function mixHex(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function litFromActivity(repo: Repo, now: number) {
  if (repo.archived) return 0.03
  const days = Math.max(0, now - day(repo.pushed))
  return Math.max(0.06, Math.min(0.9, 0.9 - 0.25 * Math.log10(1 + days)))
}

interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
const farCorner = (r: Rect) => Math.max(Math.hypot(r.x0, r.z0), Math.hypot(r.x1, r.z0), Math.hypot(r.x0, r.z1), Math.hypot(r.x1, r.z1))

export function planCity(repos: Repo[], seedText: string, sinceIso?: string): Plan {
  const seed = hashString(seedText.toLowerCase())
  const rand = rng(seed)
  const now = Date.now() / 86400_000

  // ---- districts by language (small ones merged when there are lots)
  const groups = new Map<string, Repo[]>()
  for (const r of repos) {
    const lang = r.language ?? NO_LANGUAGE
    groups.set(lang, [...(groups.get(lang) ?? []), r])
  }
  let entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  if (entries.length > MAX_DISTRICTS) {
    const keep = entries.slice(0, MAX_DISTRICTS - 1)
    const rest = entries.slice(MAX_DISTRICTS - 1).flatMap(([, list]) => list)
    entries = [...keep, ['Other languages', rest]]
  }

  // ---- each district's block: a grid of cells, biggest repos in the middle
  interface Block {
    name: string
    repos: Repo[]
    cols: number
    rows: number
    w: number
    d: number
    rect?: Rect
  }
  const blocks: Block[] = entries.map(([name, list]) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.1)))
    const rows = Math.max(1, Math.ceil(list.length / cols))
    return { name, repos: list, cols, rows, w: cols * CELL + PAD * 2, d: rows * CELL + PAD * 2 }
  })

  // ---- pack the blocks round the middle, keeping the city as round as possible
  const placed: Rect[] = []
  const grown = (r: Rect, g: number): Rect => ({ x0: r.x0 - g, z0: r.z0 - g, x1: r.x1 + g, z1: r.z1 + g })
  for (const b of blocks) {
    if (!placed.length) {
      b.rect = { x0: -b.w / 2, z0: -b.d / 2, x1: b.w / 2, z1: b.d / 2 }
      placed.push(b.rect)
      continue
    }
    let best: Rect | null = null
    let bestScore = Infinity
    for (const p of placed) {
      const xs = [p.x0, (p.x0 + p.x1) / 2 - b.w / 2, p.x1 - b.w]
      const zs = [p.z0, (p.z0 + p.z1) / 2 - b.d / 2, p.z1 - b.d]
      const candidates: Rect[] = []
      for (const x of xs) {
        candidates.push({ x0: x, z0: p.z1 + ROAD, x1: x + b.w, z1: p.z1 + ROAD + b.d })
        candidates.push({ x0: x, z0: p.z0 - ROAD - b.d, x1: x + b.w, z1: p.z0 - ROAD })
      }
      for (const z of zs) {
        candidates.push({ x0: p.x1 + ROAD, z0: z, x1: p.x1 + ROAD + b.w, z1: z + b.d })
        candidates.push({ x0: p.x0 - ROAD - b.w, z0: z, x1: p.x0 - ROAD, z1: z + b.d })
      }
      for (const c of candidates) {
        if (placed.some((q) => overlaps(grown(c, ROAD - 0.01), q))) continue
        const score = farCorner(c) + Math.hypot((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2) * 0.35
        if (score < bestScore) {
          bestScore = score
          best = c
        }
      }
    }
    b.rect = best!
    placed.push(b.rect)
  }

  // Centre the whole city.
  if (placed.length) {
    const minX = Math.min(...placed.map((r) => r.x0))
    const maxX = Math.max(...placed.map((r) => r.x1))
    const minZ = Math.min(...placed.map((r) => r.z0))
    const maxZ = Math.max(...placed.map((r) => r.z1))
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    for (const r of placed) {
      r.x0 -= cx
      r.x1 -= cx
      r.z0 -= cz
      r.z1 -= cz
    }
  }

  // ---- lots
  const lots: Lot[] = []
  const districts: District[] = []
  const freeCells: { x: number; z: number }[] = []
  blocks.forEach((b, di) => {
    const r = b.rect!
    districts.push({ name: b.name, color: b.name === 'Other languages' ? '#c9c4e6' : languageColor(b.name), count: b.repos.length, ...r })
    const cells: { x: number; z: number; dist: number }[] = []
    const ccx = (b.cols - 1) / 2
    const ccz = (b.rows - 1) / 2
    for (let i = 0; i < b.cols; i++)
      for (let j = 0; j < b.rows; j++) {
        cells.push({ x: r.x0 + PAD + (i + 0.5) * CELL, z: r.z0 + PAD + (j + 0.5) * CELL, dist: Math.hypot(i - ccx, (j - ccz) * 1.05) + rand() * 0.01 })
      }
    cells.sort((a, c) => a.dist - c.dist)
    const sorted = [...b.repos].sort((a, c) => Number(a.fork) - Number(c.fork) || c.size - a.size || a.name.localeCompare(c.name))
    sorted.forEach((repo, k) => {
      const cell = cells[k]
      // Archived repos are faded, like a building nobody uses any more.
      const color = repo.archived ? mixHex(languageColor(repo.language ?? NO_LANGUAGE), '#8d89a6', 0.7) : languageColor(repo.language ?? NO_LANGUAGE)
      if (repo.fork) {
        lots.push({ repo, kind: 'house', x: cell.x, z: cell.z, w: 1.5, d: 1.3, h: 1.25, color, lit: litFromActivity(repo, now), born: day(repo.created), district: di })
      } else {
        const t = Math.min(1, Math.log10(1 + repo.size) / 5.5)
        const w = 1.45 + 0.95 * t
        lots.push({
          repo,
          kind: 'tower',
          x: cell.x,
          z: cell.z,
          w,
          d: w * (0.82 + rand() * 0.18),
          h: heightFromSize(repo.size),
          color,
          lit: litFromActivity(repo, now),
          born: day(repo.created),
          district: di,
        })
      }
    })
    for (let k = sorted.length; k < cells.length; k++) freeCells.push(cells[k])
  })

  // ---- island size
  const asphalt = placed.map((r) => grown(r, ROAD / 2 + 0.2))
  const cityRadius = asphalt.length ? Math.max(...asphalt.map(farCorner)) : 0
  // A ring of park round the city: never tiny, but in proportion for small cities.
  const radius = Math.max(10, cityRadius + Math.max(4.5, cityRadius * 0.26))

  // ---- a lake (with a waterfall over the edge) where there's the most room
  let lake: Plan['lake'] = null
  {
    let bestAngle = 0
    let bestFree = -Infinity
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      let reach = 0
      for (let t = 0; t < radius; t += 0.5) if (asphalt.some((r) => dx * t > r.x0 && dx * t < r.x1 && dz * t > r.z0 && dz * t < r.z1)) reach = t
      const free = radius * 0.95 - reach
      if (free > bestFree + 0.01) {
        bestFree = free
        bestAngle = a
      }
    }
    // Room for a lake plus a stream to the edge, clear of every road.
    let r = Math.min(3.6, radius * 0.11, (bestFree - 2) / 2)
    while (r >= 1.2) {
      const dist = radius * 0.95 - r - 1.2
      const x = Math.cos(bestAngle) * dist
      const z = Math.sin(bestAngle) * dist
      const clear = asphalt.every((q) => Math.hypot(x - Math.max(q.x0, Math.min(x, q.x1)), z - Math.max(q.z0, Math.min(z, q.z1))) > r + 0.6)
      if (clear) {
        lake = { x, z, r, angle: bestAngle }
        break
      }
      r -= 0.3
    }
  }

  // ---- trees in the parks round the city, and in empty lots
  const trees: Plan['trees'] = []
  const step = 2.3
  for (let x = -radius; x <= radius; x += step)
    for (let z = -radius; z <= radius; z += step) {
      const px = x + (rand() - 0.5) * step * 0.8
      const pz = z + (rand() - 0.5) * step * 0.8
      if (Math.hypot(px, pz) > radius * 0.95 - 1.4) continue
      if (asphalt.some((r) => px > r.x0 - 0.9 && px < r.x1 + 0.9 && pz > r.z0 - 0.9 && pz < r.z1 + 0.9)) continue
      if (lake && Math.hypot(px - lake.x, pz - lake.z) < lake.r + 1.1) continue
      // Keep the stream from the lake to the edge clear too.
      if (lake && streamHit(lake, px, pz, radius)) continue
      if (rand() < 0.22) continue
      trees.push({ x: px, z: pz, s: 0.75 + rand() * 0.6, tone: rand() })
    }
  for (const c of freeCells) trees.push({ x: c.x + (rand() - 0.5) * 0.6, z: c.z + (rand() - 0.5) * 0.6, s: 0.7 + rand() * 0.4, tone: rand() })

  // ---- car routes: a lane round each district
  const carLoops = placed.map((r) => grown(r, ROAD / 4 + 0.05))

  const born = lots.map((l) => l.born)
  const startDay = Math.min(born.length ? Math.min(...born) : now, sinceIso ? day(sinceIso) : now)
  return { lots, districts, radius, cityRadius, trees, lake, carLoops, startDay, endDay: now, seed }
}

/** The island's slightly wobbly outline: its radius at an angle (always within 5% of the plan radius). */
export function rimRadius(plan: { radius: number; seed: number }, a: number) {
  const p1 = ((plan.seed % 1000) / 1000) * 6.283
  const p2 = (((plan.seed >>> 10) % 1000) / 1000) * 6.283
  return plan.radius * (1 + 0.03 * Math.sin(3 * a + p1) + 0.02 * Math.sin(7 * a + p2))
}

function streamHit(lake: NonNullable<Plan['lake']>, px: number, pz: number, radius: number) {
  const dx = Math.cos(lake.angle)
  const dz = Math.sin(lake.angle)
  const along = (px - lake.x) * dx + (pz - lake.z) * dz
  const across = Math.abs(-(px - lake.x) * dz + (pz - lake.z) * dx)
  return along > 0 && along < radius && across < lake.r * 0.4 + 1
}

// ---- a made-up city for the landing page (no GitHub calls needed)

const SAMPLE_NAMES = [
  'portfolio', 'api-server', 'dotfiles', 'game-engine', 'chat-app', 'notes', 'blog', 'weather-bot', 'ml-playground',
  'todo', 'compiler', 'design-system', 'cli-tools', 'landing-page', 'scraper', 'auth-service', 'shaders', 'snake',
  'budget-tracker', 'docs', 'infra', 'raytracer', 'discord-bot', 'pixel-art', 'chess-ai', 'markdown-editor',
  'url-shortener', 'music-player', 'physics-sim', 'kanban', 'recipe-app', 'f1-replay', 'tiny-planet', 'wiki',
]
const SAMPLE_LANGS = ['TypeScript', 'TypeScript', 'TypeScript', 'JavaScript', 'Python', 'Python', 'C#', 'Go', 'Rust', 'HTML', 'CSS', null, 'C++']

export function sampleRepos(): Repo[] {
  const rand = rng(20251006)
  const now = Date.now()
  return SAMPLE_NAMES.map((name, i) => {
    const created = now - (200 + rand() * 2400) * 86400_000
    const pushed = Math.min(now, created + rand() * (now - created))
    const size = Math.round(Math.pow(10, 1 + rand() * 4.6))
    return {
      name,
      description: null,
      language: SAMPLE_LANGS[Math.floor(rand() * SAMPLE_LANGS.length)],
      size,
      stars: rand() < 0.4 ? Math.round(Math.pow(10, rand() * 3)) : 0,
      forks: 0,
      issues: 0,
      fork: i % 9 === 4,
      archived: i % 13 === 7,
      created: new Date(created).toISOString(),
      pushed: new Date(pushed).toISOString(),
      url: 'https://github.com',
    }
  })
}
