import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

const dateOf = (day: number) => new Date(day * 86400_000)

/** Scrub through time and watch the city get built. */
export function Timeline({ start, end, day, playing, built, total, onScrub, onPlay, onPause }: { start: number; end: number; day: number; playing: boolean; built: number; total: number; onScrub: (day: number) => void; onPlay: () => void; onPause: () => void }) {
  const shown = Math.min(end, Math.max(start, day))
  const label = dateOf(shown).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return (
    <div className="flex w-full items-center gap-3 rounded-full bg-card/90 py-2 pr-5 pl-2 shadow-xl ring-1 ring-white/10">
      <Button size="icon-lg" className="size-10 shrink-0 rounded-full" onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause the time-lapse' : 'Play the time-lapse'}>
        {playing ? <Pause aria-hidden /> : <Play className="translate-x-px" aria-hidden />}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="font-display text-sm font-semibold tabular-nums" aria-live="off">
            {label}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {built} of {total} built
          </span>
        </div>
        <Slider
          aria-label="Time"
          aria-valuetext={label}
          min={Math.floor(start)}
          max={Math.ceil(end)}
          step={1}
          value={[Math.round(shown)]}
          onValueChange={(v) => onScrub(Array.isArray(v) ? v[0] : (v as number))}
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{dateOf(start).getFullYear()}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  )
}
