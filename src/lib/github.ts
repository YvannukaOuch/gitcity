/**
 * Public GitHub data, fetched straight from the browser (GitHub allows it; each visitor gets their
 * own allowance of 60 requests an hour). Cities are cached in the browser for a few hours.
 */

export interface Profile {
  login: string
  name: string | null
  avatar: string
  url: string
  bio: string | null
  repos: number
  followers: number
  created: string
  type: 'User' | 'Organization'
}

export interface Repo {
  name: string
  description: string | null
  language: string | null
  /** Size in KB, as GitHub reports it. */
  size: number
  stars: number
  forks: number
  issues: number
  fork: boolean
  archived: boolean
  created: string
  pushed: string
  url: string
}

export interface CityData {
  profile: Profile
  repos: Repo[]
  /** Only the most recently active repos are built when someone has a lot. */
  total: number
  fetchedAt: number
}

export class GitHubError extends Error {
  kind: 'not-found' | 'rate-limit' | 'network' | 'other'
  resetAt?: number
  constructor(kind: GitHubError['kind'], message: string, resetAt?: number) {
    super(message)
    this.kind = kind
    this.resetAt = resetAt
  }
}

export const MAX_REPOS = 10000
const CACHE_HOURS = 6
const CACHE_KEY = (login: string) => `gitcity:${login.toLowerCase()}`

export const isUsername = (s: string) => /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(s)

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new GitHubError('network', 'Couldn’t reach GitHub. Check your connection and try again.')
  }
  if (res.status === 404) throw new GitHubError('not-found', 'There’s no GitHub user or organisation with that name.')
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 3600_000
    throw new GitHubError('rate-limit', 'GitHub only allows 60 lookups an hour from one network, and that’s used up.', reset)
  }
  if (!res.ok) throw new GitHubError('other', `GitHub answered with an error (${res.status}). Try again in a moment.`)
  return res.json() as Promise<T>
}

interface RawUser {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  bio: string | null
  public_repos: number
  followers: number
  created_at: string
  type: string
}

interface RawRepo {
  name: string
  description: string | null
  language: string | null
  size: number
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  fork: boolean
  archived: boolean
  created_at: string
  pushed_at: string | null
  html_url: string
}

function readCache(login: string): CityData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(login))
    if (!raw) return null
    const data = JSON.parse(raw) as CityData
    // Saved under an older, lower repo cap: fetch again so the whole account shows.
    if (data.repos.length < Math.min(data.total, MAX_REPOS) && data.repos.length % 100 === 0) return null
    return Date.now() - data.fetchedAt < CACHE_HOURS * 3600_000 ? data : null
  } catch {
    return null
  }
}

function writeCache(data: CityData) {
  try {
    localStorage.setItem(CACHE_KEY(data.profile.login), JSON.stringify(data))
  } catch {
    // Storage full or blocked: the city still works, it just isn't remembered.
  }
}

/** Everything needed to build someone's city. `onProgress` reports pages of repos as they arrive. */
export async function loadCity(login: string, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<CityData> {
  const cached = readCache(login)
  if (cached) return cached

  const u = await get<RawUser>(`/users/${encodeURIComponent(login)}`, signal)
  const profile: Profile = {
    login: u.login,
    name: u.name,
    avatar: u.avatar_url,
    url: u.html_url,
    bio: u.bio,
    repos: u.public_repos,
    followers: u.followers,
    created: u.created_at,
    type: u.type === 'Organization' ? 'Organization' : 'User',
  }
  const want = Math.min(profile.repos, MAX_REPOS)
  onProgress?.(0, want)

  const repos: Repo[] = []
  for (let page = 1; repos.length < want && page <= Math.ceil(MAX_REPOS / 100); page++) {
    const kind = profile.type === 'Organization' ? 'orgs' : 'users'
    let list: RawRepo[]
    try {
      list = await get<RawRepo[]>(`/${kind}/${encodeURIComponent(u.login)}/repos?per_page=100&page=${page}&sort=pushed&direction=desc${kind === 'users' ? '&type=owner' : ''}`, signal)
    } catch (err) {
      // Out of GitHub lookups part-way through a big account: build with what has arrived.
      if (err instanceof GitHubError && err.kind === 'rate-limit' && repos.length) break
      throw err
    }
    for (const r of list) {
      repos.push({
        name: r.name,
        description: r.description,
        language: r.language,
        size: r.size,
        stars: r.stargazers_count,
        forks: r.forks_count,
        issues: r.open_issues_count,
        fork: r.fork,
        archived: r.archived,
        created: r.created_at,
        pushed: r.pushed_at ?? r.created_at,
        url: r.html_url,
      })
    }
    onProgress?.(Math.min(repos.length, want), want)
    if (list.length < 100) break
  }

  const data: CityData = { profile, repos: repos.slice(0, MAX_REPOS), total: profile.repos, fetchedAt: Date.now() }
  writeCache(data)
  return data
}

/** Cities you've looked at, newest first (for quick switching). */
export function recentCities(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem('gitcity:recent') ?? '[]')
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function rememberCity(login: string) {
  try {
    const list = recentCities().filter((l) => l.toLowerCase() !== login.toLowerCase())
    localStorage.setItem('gitcity:recent', JSON.stringify([login, ...list].slice(0, 8)))
  } catch {
    // Not remembered; fine.
  }
}

// ---- formatting

export function formatSize(kb: number) {
  if (kb < 1024) return `${kb} KB`
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(kb < 10 * 1024 ? 1 : 0)} MB`
  return `${(kb / 1024 / 1024).toFixed(1)} GB`
}

export function formatCount(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ago(iso: string) {
  const days = (Date.now() - new Date(iso).getTime()) / 86400_000
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 30) return `${Math.floor(days)} days ago`
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
  const y = Math.floor(days / 365)
  return `${y} year${y === 1 ? '' : 's'} ago`
}
