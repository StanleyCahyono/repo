/**
 * Day allowance as a punch card: one square per day, used days punched in one after another. Text always states the
 * numbers, so the squares are never the only cue. Large allowances (> 20 days) fall back to a single growing bar.
 * `onColor` draws in the current text colour for use on a filled verdict card.
 */
import type { CSSProperties } from 'react'
import { cn } from '@/lib/ui/cn'
import { plural } from './format'
import css from './hud.module.css'

export function PunchMeter({ total, used, label, className, compact = false, onColor = false }: { total: number; used: number; label?: string; className?: string; compact?: boolean; onColor?: boolean }) {
  const u = Math.max(0, Math.min(total, used))
  const left = total - u
  const text = `${u} of ${plural(total, 'day')} used`
  const fill = onColor ? 'border-current bg-current' : left === 0 ? 'border-critical bg-critical' : 'border-teal bg-teal'
  const empty = onColor ? 'border-current/60 bg-transparent' : 'border-divider-strong bg-surface'
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {total <= 20 ? (
        <span role="img" aria-label={`${label ? `${label}: ` : ''}${text}, ${left} left`} className="inline-flex flex-wrap gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              aria-hidden
              style={{ '--i': i } as CSSProperties}
              className={cn('inline-block rounded-[3px] border', compact ? 'size-3' : 'size-3.5', i < u ? cn(fill, css.punch) : empty)}
            />
          ))}
        </span>
      ) : (
        <span role="img" aria-label={`${label ? `${label}: ` : ''}${text}, ${left} left`} className={cn('relative inline-block h-2.5 w-40 overflow-hidden rounded-full', onColor ? 'bg-current/20' : 'bg-surface-3')}>
          <span aria-hidden className={cn('absolute inset-y-0 left-0 rounded-full', css.grow, onColor ? 'bg-current' : left === 0 ? 'bg-critical' : 'bg-teal')} style={{ width: `${(u / total) * 100}%` }} />
        </span>
      )}
      <span aria-hidden className={cn('text-[12.5px] tnum', onColor ? 'opacity-90' : 'text-ink-2')}>
        {label ? <span className={onColor ? '' : 'text-ink-3'}>{label} · </span> : null}
        {u}/{total} used · <span className={cn(onColor ? 'font-semibold' : left === 0 ? 'font-medium text-critical' : 'text-ink')}>{left === 0 ? 'none left' : `${left} left`}</span>
      </span>
    </div>
  )
}
