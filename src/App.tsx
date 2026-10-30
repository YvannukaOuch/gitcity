import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Building2, Camera, Check, Home, Link2, Loader2, Map as MapIcon, Maximize, Moon, Star, Sun, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Guide } from '@/components/Guide'
import { RepoCard } from '@/components/RepoCard'
import { SearchForm } from '@/components/SearchForm'
import { Timeline } from '@/components/Timeline'
import { formatCount, formatSize, GitHubError, isUsername, loadCity, MAX_REPOS, recentCities, rememberCity, type CityData } from '@/lib/github'
import { planCity, sampleRepos, type Lot, type Plan } from '@/lib/layout'
import { cn } from '@/lib/utils'
import { CityScene } from '@/scene/engine'

type View =
  | { kind: 'home' }
  | { kind: 'loading'; login: string; loaded: number; total: number }
  | { kind: 'city'; data: CityData; plan: Plan }
  | { kind: 'error'; login: string; error: GitHubError }

const EXAMPLES = ['YvannukaOuch', 'torvalds', 'sindresorhus', 'gaearon']

function loginFromPath() {
  const p = decodeURIComponent(window.location.pathname.replace(/^\/+|\/+$/g, ''))
  return p && isUsername(p) ? p : null
}

function readNight() {
  try {
    return localStorage.getItem('gitcity:day') !== '1'
  } catch {
    return true
  }
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [webglError, setWebglError] = useState(false)
  const [night, setNight] = useState(readNight)
  const [selected, setSelected] = useState<Lot | null>(null)
  const [hover, setHover] = useState<{ lot: Lot; x: number; y: number } | null>(null)
  const [time, setTime] = useState({ day: 0, playing: false })
  const [guide, setGuide] = useState(() => window.innerWidth >= 1024)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const showToast = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3200)
  }

  // ---- the 3D scene lives for the whole visit
  useEffect(() => {
    let scene: CityScene
    try {
      scene = new CityScene(hostRef.current!, {
        onHover: (lot, x, y) => setHover(lot ? { lot, x, y } : null),
        onSelect: (lot) => setSelected(lot),
        onTimeline: (day, playing) => setTime({ day, playing }),
      })
    } catch {
      setWebglError(true)
      return
    }
    sceneRef.current = scene
    scene.setNight(readNight())
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  const showHome = useCallback(() => {
    abortRef.current?.abort()
    setSelected(null)
    setView({ kind: 'home' })
    document.title = 'GitCity · your GitHub as a tiny city'
    const plan = planCity(sampleRepos(), 'gitcity-sample')
    sceneRef.current?.setPlan(plan, { intro: true, framing: 'home' })
    setTime({ day: plan.endDay, playing: false })
  }, [])

  const showCity = useCallback(async (login: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setSelected(null)
    setView({ kind: 'loading', login, loaded: 0, total: 0 })
    document.title = `${login} · GitCity`
    try {
      const data = await loadCity(login, (loaded, total) => !ctrl.signal.aborted && setView({ kind: 'loading', login, loaded, total }), ctrl.signal)
      if (ctrl.signal.aborted) return
      const plan = planCity(data.repos, data.profile.login, data.profile.created)
      sceneRef.current?.setPlan(plan, { intro: true })
      setView({ kind: 'city', data, plan })
      setTime({ day: plan.startDay, playing: true })
      rememberCity(data.profile.login)
      document.title = `${data.profile.name || data.profile.login}’s city · GitCity`
      // Use GitHub's capitalisation in the address.
      if (data.profile.login !== login) history.replaceState(null, '', `/${data.profile.login}`)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setView({ kind: 'error', login, error: e instanceof GitHubError ? e : new GitHubError('other', 'Something went wrong building that city.') })
      // Nothing behind the message yet (opened straight on this address): show the example island.
      if (sceneRef.current && !sceneRef.current.hasPlan()) sceneRef.current.setPlan(planCity(sampleRepos(), 'gitcity-sample'), { intro: false, framing: 'home' })
    }
  }, [])

  // ---- the address decides what's shown
  useEffect(() => {
    if (webglError) return
    const route = () => {
      const login = loginFromPath()
      if (login) void showCity(login)
      else showHome()
    }
    route()
    window.addEventListener('popstate', route)
    return () => window.removeEventListener('popstate', route)
  }, [showCity, showHome, webglError])

  const go = (login: string | null) => {
    history.pushState(null, '', login ? `/${login}` : '/')
    if (login) void showCity(login)
    else showHome()
  }

  useEffect(() => {
    sceneRef.current?.setNight(night)
    try {
      localStorage.setItem('gitcity:day', night ? '0' : '1')
    } catch {
      // Not remembered; fine.
    }
  }, [night])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) {
        sceneRef.current?.select(null, false)
        setSelected(null)
      } else setGuide(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const pick = (lot: Lot) => {
    sceneRef.current?.select(lot)
    setSelected(lot)
    if (window.innerWidth < 1024) setGuide(false)
  }

  const snapshot = async () => {
    if (view.kind !== 'city') return
    const blob = await sceneRef.current?.snapshot(`gitcity.sraas.dev/${view.data.profile.login}`)
    if (!blob) return showToast('Couldn’t save the picture.')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gitcity-${view.data.profile.login}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      showToast('Link copied. Anyone can open this city.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast(window.location.href)
    }
  }

  const plan = view.kind === 'city' ? view.plan : null
  const built = useMemo(() => (plan ? plan.lots.filter((l) => l.born <= time.day).length : 0), [plan, time.day])
  const stars = view.kind === 'city' ? view.data.repos.reduce((n, r) => n + (r.fork ? 0 : r.stars), 0) : 0

  if (webglError)
    return (
      <div className="sky grid h-dvh place-items-center p-6 text-center text-white">
        <div className="max-w-sm">
          <AlertTriangle className="mx-auto size-10 text-primary" aria-hidden />
          <h1 className="mt-4 font-display text-2xl font-semibold">This browser can’t draw the city</h1>
          <p className="mt-2 text-sm text-white/75">GitCity needs WebGL (3D graphics). Try an up-to-date Chrome, Edge, Firefox or Safari, or turn on hardware acceleration.</p>
        </div>
      </div>
    )

  return (
    <TooltipProvider delay={300}>
      <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground select-none">
        {/* Sky: night and day, cross-faded. */}
        <div className="sky absolute inset-0" aria-hidden />
        <div className={cn('sky sky-day absolute inset-0', night ? 'opacity-0' : 'opacity-100')} aria-hidden />
        <div ref={hostRef} className="absolute inset-0" />

        {/* ---------- home ---------- */}
        {view.kind === 'home' && <HomePanel onGo={go} />}

        {/* ---------- top bar over a city ---------- */}
        {view.kind !== 'home' && (
          <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-5">
            <div className="pointer-events-auto flex min-w-0 flex-col gap-3">
              <button type="button" onClick={() => go(null)} className="flex w-fit items-center gap-2 rounded-full font-display text-lg font-semibold text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Logo />
                GitCity
              </button>
              {view.kind === 'city' && <ProfileCard data={view.data} stars={stars} />}
            </div>
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <div className="flex items-center gap-1 rounded-full bg-card/90 p-1 shadow-lg ring-1 ring-white/10">
                {view.kind === 'city' && (
                  <>
                    <ToolButton label={guide ? 'Hide the city guide' : 'City guide and all repos'} pressed={guide} onClick={() => setGuide((g) => !g)}>
                      <MapIcon />
                    </ToolButton>
                    <ToolButton label="Show the whole city" onClick={() => sceneRef.current?.fitView()}>
                      <Maximize />
                    </ToolButton>
                    <ToolButton label="Save a picture" onClick={snapshot}>
                      <Camera />
                    </ToolButton>
                    <ToolButton label="Copy link to this city" onClick={share}>
                      {copied ? <Check /> : <Link2 />}
                    </ToolButton>
                  </>
                )}
                <ToolButton label={night ? 'Daytime' : 'Night-time'} onClick={() => setNight((n) => !n)}>
                  {night ? <Sun /> : <Moon />}
                </ToolButton>
              </div>
              {view.kind === 'city' && (
                <div className="w-64 max-sm:hidden">
                  <SearchForm onSubmit={go} size="sm" id="switch-user" />
                </div>
              )}
            </div>
          </header>
        )}

        {/* ---------- loading and errors ---------- */}
        {view.kind === 'loading' && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center p-4" role="status">
            <div className="flex items-center gap-3 rounded-full bg-card/95 px-5 py-3 font-display font-semibold shadow-xl ring-1 ring-white/10">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
              {view.total ? `Laying foundations… ${view.loaded} of ${view.total} repos` : `Finding ${view.login} on GitHub…`}
            </div>
          </div>
        )}
        {view.kind === 'error' && <ErrorPanel view={view} onGo={go} />}

        {/* ---------- a city ---------- */}
        {plan && view.kind === 'city' && (
          <>
            {plan.lots.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center p-4">
                <p className="rounded-2xl bg-card/95 px-5 py-3 text-center font-display font-semibold shadow-xl ring-1 ring-white/10">No public repos yet — just a quiet island for now.</p>
              </div>
            )}

            <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-end gap-3 p-3 pb-28 max-sm:inset-x-0 max-sm:pb-32 sm:top-36 sm:p-5 sm:pb-32">
              {selected ? (
                <div className="pointer-events-auto">
                  <RepoCard
                    lot={selected}
                    onClose={() => {
                      sceneRef.current?.select(null, false)
                      setSelected(null)
                    }}
                  />
                </div>
              ) : (
                guide && (
                  <div className="pointer-events-auto flex min-h-0 max-sm:max-h-[60dvh]">
                    <Guide plan={plan} onPick={pick} onClose={() => setGuide(false)} />
                  </div>
                )
              )}
            </div>

            {plan.lots.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-5">
                <div className="pointer-events-auto w-full max-w-xl">
                  <Timeline
                    start={plan.startDay}
                    end={plan.endDay}
                    day={time.day}
                    playing={time.playing}
                    built={built}
                    total={plan.lots.length}
                    onScrub={(d) => {
                      sceneRef.current?.pause()
                      sceneRef.current?.setDay(d)
                      setTime({ day: d, playing: false })
                    }}
                    onPlay={() => sceneRef.current?.play()}
                    onPause={() => sceneRef.current?.pause()}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* What's under the pointer. */}
        {hover && hover.lot !== selected && (
          <div className="pointer-events-none fixed z-50 rounded-xl bg-card/95 px-3 py-2 text-sm shadow-lg ring-1 ring-white/10" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <p className="font-display font-semibold">{hover.lot.repo.name}</p>
            <p className="text-xs text-muted-foreground">
              {hover.lot.repo.language ?? 'No language'} · {formatSize(hover.lot.repo.size)}
              {hover.lot.repo.stars > 0 && ` · ★ ${formatCount(hover.lot.repo.stars)}`}
            </p>
          </div>
        )}

        <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          {toast && <p className="max-w-full truncate rounded-full bg-card/95 px-4 py-2 text-sm font-semibold shadow-lg ring-1 ring-white/10">{toast}</p>}
        </div>
      </div>
    </TooltipProvider>
  )
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md', className)} aria-hidden>
      <Building2 className="size-4.5" />
    </span>
  )
}

function ToolButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn('size-9 rounded-full text-white/85 hover:bg-white/10 hover:text-white', pressed && 'bg-white/15 text-white')}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function HomePanel({ onGo }: { onGo: (login: string) => void }) {
  const recent = recentCities().filter((r) => !EXAMPLES.some((e) => e.toLowerCase() === r.toLowerCase()))
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-4 pb-6 sm:p-8">
      <div className="pointer-events-auto mt-[6vh] w-full max-w-xl text-center sm:mt-[9vh]">
        <div className="mb-4 flex items-center justify-center gap-3">
          <Logo className="size-11 rounded-2xl [&_svg]:size-6" />
          <h1 className="font-display text-5xl font-bold tracking-tight text-white drop-shadow-[0_3px_0_rgb(0_0_0/0.25)] sm:text-6xl">GitCity</h1>
        </div>
        <p className="mx-auto max-w-md text-base text-white/85 sm:text-lg">Anyone’s GitHub, as a tiny floating city. Every repo is a building, as tall as the repo is big.</p>
        <div className="mx-auto mt-7 max-w-lg">
          <SearchForm onSubmit={onGo} autoFocus />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-white/70">Try</span>
          {[...EXAMPLES, ...recent.slice(0, 3)].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onGo(name)}
              className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white ring-1 ring-white/15 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <p className="pointer-events-auto max-w-md text-center text-xs text-white/60">
        Built from public GitHub data, straight in your browser. This one’s a made-up example city.
      </p>
    </div>
  )
}

function ProfileCard({ data, stars }: { data: CityData; stars: number }) {
  const p = data.profile
  const shown = data.repos.length
  return (
    <section aria-label="Whose city this is" className="w-[min(20rem,calc(100vw-1.5rem))] rounded-3xl bg-card/90 p-4 shadow-xl ring-1 ring-white/10 max-sm:p-3">
      <div className="flex items-center gap-3">
        <img src={p.avatar} alt="" className="size-12 shrink-0 rounded-2xl ring-2 ring-white/15 max-sm:size-10" />
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg leading-tight font-semibold">{p.name || p.login}’s city</h2>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            @{p.login}
          </a>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center max-sm:hidden">
        <Stat icon={<Building2 className="size-3.5" />} label="Buildings" value={formatCount(shown)} />
        <Stat icon={<Star className="size-3.5" />} label="Stars" value={formatCount(stars)} />
        <Stat icon={<Users className="size-3.5" />} label="Followers" value={formatCount(p.followers)} />
      </dl>
      {data.total > shown && <p className="mt-2 text-xs text-muted-foreground max-sm:hidden">Showing the {MAX_REPOS} most recently active of {formatCount(data.total)} repos.</p>}
    </section>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/6 px-2 py-2">
      <dd className="font-display text-base font-semibold tabular-nums">{value}</dd>
      <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </dt>
    </div>
  )
}

function ErrorPanel({ view, onGo }: { view: Extract<View, { kind: 'error' }>; onGo: (login: string | null) => void }) {
  const e = view.error
  const reset = e.resetAt ? new Date(e.resetAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
      <div className="pointer-events-auto w-full max-w-md rounded-3xl bg-card/95 p-6 text-center shadow-2xl ring-1 ring-white/10" role="alert">
        <AlertTriangle className="mx-auto size-9 text-primary" aria-hidden />
        <h2 className="mt-3 font-display text-xl font-semibold">{e.kind === 'not-found' ? `No one called “${view.login}”` : e.kind === 'rate-limit' ? 'GitHub needs a breather' : 'Couldn’t build that city'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {e.message}
          {e.kind === 'rate-limit' && reset && ` It resets at ${reset}. Cities you’ve already seen still work.`}
        </p>
        <div className="mx-auto mt-5 max-w-sm">
          <SearchForm onSubmit={onGo} size="sm" id="retry-user" />
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {e.kind !== 'not-found' && (
            <Button variant="secondary" className="rounded-full" onClick={() => onGo(view.login)}>
              Try again
            </Button>
          )}
          <Button variant="ghost" className="rounded-full" onClick={() => onGo(null)}>
            <Home aria-hidden />
            Home
          </Button>
        </div>
      </div>
    </div>
  )
}
