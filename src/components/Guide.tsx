import { useMemo, useState } from 'react'
import { Archive, Building2, GitFork, Lightbulb, Ruler, Search, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatSize } from '@/lib/github'
import type { Lot, Plan } from '@/lib/layout'

const KEY = [
  { icon: Ruler, text: 'Height = repo size', title: 'Each storey up is roughly double the size' },
  { icon: Building2, text: 'District = language', title: 'Biggest repos stand in the middle' },
  { icon: Lightbulb, text: 'Glowing portholes = recent work', title: 'More portholes glow the more recently it was worked on' },
  { icon: Star, text: 'Beacon = stars', title: 'Taller and brighter with more stars' },
  { icon: GitFork, text: 'Little dome = fork', title: 'Forks of other people’s repos' },
  { icon: Archive, text: 'Faded = archived', title: 'Archived repos' },
]

/** What everything means, the districts, and every building to jump to. */
export function Guide({ plan, onPick, onClose }: { plan: Plan; onPick: (lot: Lot) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const lots = useMemo(() => {
    const term = q.trim().toLowerCase()
    return [...plan.lots].filter((l) => !term || l.repo.name.toLowerCase().includes(term)).sort((a, b) => b.repo.size - a.repo.size)
  }, [plan, q])

  return (
    <aside aria-label="City guide" className="flex max-h-full w-full flex-col overflow-hidden rounded-3xl bg-card/95 text-card-foreground shadow-2xl ring-1 ring-white/10 sm:w-80">
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="font-display text-lg font-semibold">City guide</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the guide" className="-mr-2">
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted-foreground" aria-label="How to read the city">
          {KEY.map(({ icon: Icon, text, title }) => (
            <li key={text} className="flex items-start gap-1.5" title={title}>
              <Icon className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
              {text}
            </li>
          ))}
        </ul>

        {plan.districts.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 font-display text-sm font-semibold">Districts</h3>
            <ul className="flex flex-wrap gap-1.5">
              {plan.districts.map((d) => (
                <li key={d.name} className="flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-xs">
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} aria-hidden />
                  {d.name}
                  <span className="text-muted-foreground tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>

            <h3 className="mt-5 mb-2 font-display text-sm font-semibold">Buildings</h3>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a repo" aria-label="Find a repo" className="pl-8" />
            </div>
            <ul className="mt-2 space-y-0.5" aria-label="Repos, biggest first">
              {lots.slice(0, 200).map((l) => (
                <li key={l.repo.name}>
                  <button
                    type="button"
                    onClick={() => onPick(l)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: l.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{l.repo.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(l.repo.size)}</span>
                  </button>
                </li>
              ))}
              {!lots.length && <li className="px-2 py-3 text-sm text-muted-foreground">No repo by that name.</li>}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
