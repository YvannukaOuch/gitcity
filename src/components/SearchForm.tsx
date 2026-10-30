import { useState } from 'react'
import { ArrowRight, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isUsername } from '@/lib/github'
import { cn } from '@/lib/utils'

/** "GitHub username" box. Big on the home page, compact over a city. */
export function SearchForm({ onSubmit, busy, size = 'lg', autoFocus, id = 'username' }: { onSubmit: (login: string) => void; busy?: boolean; size?: 'lg' | 'sm'; autoFocus?: boolean; id?: string }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const login = value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/\/.*$/, '')
    if (!login) return setError('Type a GitHub username')
    if (!isUsername(login)) return setError('That isn’t a valid GitHub username')
    setError(null)
    onSubmit(login)
  }
  const lg = size === 'lg'
  return (
    <form onSubmit={submit} noValidate className="w-full" role="search">
      <label htmlFor={id} className="sr-only">
        GitHub username
      </label>
      <div className={cn('flex items-center gap-2 rounded-full bg-white/8 p-1.5 ring-1 ring-white/15 focus-within:ring-2 focus-within:ring-primary', !lg && 'p-1')}>
        <Search className={cn('ml-2 shrink-0 text-muted-foreground', lg ? 'size-5' : 'size-4')} aria-hidden />
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          placeholder={lg ? 'GitHub username, e.g. torvalds' : 'Another username'}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn('h-auto border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent', lg ? 'text-lg' : 'text-sm')}
        />
        <Button type="submit" disabled={busy} className={cn('shrink-0 rounded-full font-display font-semibold', lg ? 'h-11 px-5 text-base' : 'h-8 px-3')}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
          {lg ? 'Build city' : <span className="sr-only">Build city</span>}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-2 px-4 text-sm font-semibold text-[#ff8fa3]">
          {error}
        </p>
      )}
    </form>
  )
}
