import { Archive, ExternalLink, GitFork, Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ago, formatCount, formatDate, formatSize } from '@/lib/github'
import { NO_LANGUAGE } from '@/lib/languages'
import type { Lot } from '@/lib/layout'

/** About the building you clicked. */
export function RepoCard({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const r = lot.repo
  const facts = [
    { label: 'Size', value: formatSize(r.size), hint: 'the building’s height' },
    { label: 'Stars', value: formatCount(r.stars) },
    { label: 'Forks', value: formatCount(r.forks) },
    { label: 'Open issues', value: formatCount(r.issues) },
    { label: 'Built', value: formatDate(r.created) },
    { label: 'Last work', value: ago(r.pushed) },
  ]
  return (
    <aside aria-label={`About ${r.name}`} className="w-full rounded-3xl bg-card/95 p-5 text-card-foreground shadow-2xl ring-1 ring-white/10 sm:w-80">
      <div className="flex items-start gap-3">
        <span className="mt-1 size-4 shrink-0 rounded-md" style={{ background: lot.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl leading-tight font-semibold break-words">{r.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{r.language ?? NO_LANGUAGE}</Badge>
            {r.fork && (
              <Badge variant="secondary">
                <GitFork aria-hidden />
                Fork
              </Badge>
            )}
            {r.archived && (
              <Badge variant="secondary">
                <Archive aria-hidden />
                Archived
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 shrink-0">
          <X aria-hidden />
        </Button>
      </div>
      {r.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.description}</p>}
      <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 text-sm">
        {facts.map((f) => (
          <div key={f.label} title={f.hint}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="font-display font-semibold tabular-nums">
              {f.label === 'Stars' && r.stars > 0 && <Star className="mr-1 inline size-3.5 -translate-y-px fill-[#ffc94a] text-[#ffc94a]" aria-hidden />}
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      <Button render={<a href={r.url} target="_blank" rel="noopener noreferrer" />} className="mt-5 h-10 w-full rounded-full font-display font-semibold">
        Open on GitHub
        <ExternalLink aria-hidden />
      </Button>
    </aside>
  )
}
