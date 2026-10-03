/**
 * Pass-family badges for resort cards. A badge says a family has a product with recorded access (or a discount) at
 * the resort — never an ownership claim. Rules recorded as 'unknown' are not shown, so they make no badge.
 * Discount-only access keeps its fill but gets a dashed border.
 */
import { PassBadge } from '@/components/ui/badge'
import { cn } from '@/lib/ui/cn'
import type { CardPassBadge } from './card-data'

export function CardPassBadges({
  passes,
  seasonLabel,
  className,
  size = 'sm',
}: {
  passes: CardPassBadge[]
  /** e.g. "2026–27" — used in the discount-only caption for screen readers. */
  seasonLabel?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  if (!passes.length) return null
  const season = seasonLabel ? `${seasonLabel} ` : ''
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Pass families with access here">
        {passes.map((p) => (
          <li key={p.familyId} title={p.title} className="inline-flex">
            <PassBadge family={p.familyId} size={size} className={cn(p.qualifiedOnly ? 'border-dashed' : undefined)} />
            {p.qualifiedOnly ? <span className="sr-only"> — {season}discount only</span> : null}
          </li>
        ))}
      </ul>
    </span>
  )
}
