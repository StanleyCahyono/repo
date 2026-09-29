/** Relative time with the absolute timestamp (home time zone) on hover and for assistive tech. Server-renderable. */
import { formatInstant, relativeLabel } from '@/lib/domain/time'
import { cn } from '@/lib/ui/cn'

export function Ago({ at, now, tz, never = 'never', className, absolute = false }: { at: string | null | undefined; now: string; tz: string; never?: string; className?: string; absolute?: boolean }) {
  if (!at) return <span className={cn('text-ink-3 italic', className)}>{never}</span>
  const abs = formatInstant(at, tz, 'ccc d LLL yyyy, HH:mm ZZZZ')
  return (
    <time dateTime={at} title={abs} className={cn('tnum', className)}>
      {relativeLabel(at, now)}
      {absolute ? <span className="text-ink-3"> · {formatInstant(at, tz, 'd LLL, HH:mm')}</span> : <span className="sr-only"> ({abs})</span>}
    </time>
  )
}
