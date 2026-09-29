/**
 * Day allowance as a punch card: one square per day, used days filled. Text always states the numbers, so the
 * squares are never the only cue. Large allowances (> 20 days) fall back to a single bar.
 */
import { cn } from '@/lib/ui/cn'
import { plural } from './format'

export function PunchMeter({ total, used, label, className, compact = false }: { total: number; used: number; label?: string; className?: string; compact?: boolean }) {
  const u = Math.max(0, Math.min(total, used))
  const left = total - u
  const text = `${u} of ${plural(total, 'day')} used`
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {total <= 20 ? (
        <span role="img" aria-label={`${label ? `${label}: ` : ''}${text}, ${left} left`} className="inline-flex flex-wrap gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'inline-block rounded-[3px] border',
                compact ? 'size-3' : 'size-3.5',
                i < u ? (left === 0 ? 'border-critical bg-critical' : 'border-teal bg-teal') : 'border-divider-strong bg-surface',
              )}
            />
          ))}
        </span>
      ) : (
        <span role="img" aria-label={`${label ? `${label}: ` : ''}${text}, ${left} left`} className="relative inline-block h-2.5 w-40 overflow-hidden rounded-full bg-surface-3">
          <span aria-hidden className={cn('absolute inset-y-0 left-0 rounded-full', left === 0 ? 'bg-critical' : 'bg-teal')} style={{ width: `${(u / total) * 100}%` }} />
        </span>
      )}
      <span aria-hidden className="text-[12.5px] text-ink-2 tnum">
        {label ? <span className="text-ink-3">{label} · </span> : null}
        {u}/{total} used · <span className={cn(left === 0 ? 'font-medium text-critical' : 'text-ink')}>{left === 0 ? 'none left' : `${left} left`}</span>
      </span>
    </div>
  )
}
