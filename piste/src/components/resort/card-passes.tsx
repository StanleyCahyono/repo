/**
 * Pass-family badges for resort cards. Discovery only — never an ownership or access claim.
 *
 * A family whose rules for the season are all 'unknown' is drawn DASHED on a transparent fill, and a visible caption
 * says "2026–27 unconfirmed" (screen readers hear it per badge), so an unconfirmed affiliation never looks like a
 * confirmed one. Discount-only / qualified access keeps its fill but gets a dashed border.
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
  /** e.g. "2026–27" — used in the unconfirmed caption. */
  seasonLabel?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  if (!passes.length) return null
  const unconfirmed = passes.filter((p) => !p.confirmed).length
  const season = seasonLabel ? `${seasonLabel} ` : ''
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Pass families (discovery only)">
        {passes.map((p) => (
          <li key={p.familyId} title={p.title} className="inline-flex">
            <PassBadge
              family={p.familyId}
              size={size}
              className={cn(!p.confirmed ? 'border-dashed bg-transparent' : p.qualifiedOnly ? 'border-dashed' : undefined)}
            />
            <span className="sr-only">
              {p.confirmed ? (p.qualifiedOnly ? ` — ${season}discount or unconfirmed access only` : '') : ` — ${season}access unconfirmed`}
            </span>
          </li>
        ))}
      </ul>
      {unconfirmed ? (
        <span aria-hidden className="text-[12px] text-ink-3">
          {unconfirmed === passes.length ? `${season}unconfirmed` : `dashed: ${season}unconfirmed`}
        </span>
      ) : null}
    </span>
  )
}
