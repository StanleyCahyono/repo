/**
 * Fit with the group: for each resort on the trip, Piste's fit for you and your companions (terrain, learning
 * support, travel, cost), with the unknowns that were NOT counted in the resort's favour.
 */
import { Missing } from '@/components/ui/provenance'
import type { TripPage } from '@/lib/data/trip-plan'
import { cn } from '@/lib/ui/cn'

const TONE: Record<string, string> = {
  'Great fit': 'text-positive',
  'Good fit': 'text-positive',
  'Mixed fit': 'text-caution',
  'Poor fit': 'text-critical',
  'Not enough information': 'text-ink-3',
}

export function FitList({ page }: { page: TripPage }) {
  const fits = page.detail.fit.filter((f) => page.detail.resortDays.some((d) => d.resortId === f.resortId))
  if (!fits.length) return null
  const companion = page.detail.trip.companions.find((c) => c.ability)
  return (
    <div className="rounded-[12px] border border-divider bg-surface p-4">
      <p className="text-[14.5px] font-semibold text-ink">Fit for this group</p>
      <p className="text-[12.5px] text-ink-3">
        You{companion ? ` and ${companion.name}, ${companion.ability}` : ''} · a personal match, separate from the day’s conditions
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-divider">
        {fits.map((f) => (
          <li key={f.resortId} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[14px] font-medium text-ink">{f.name}</p>
              <p className={cn('text-[14px] font-semibold tnum', TONE[f.fit.label] ?? 'text-ink')}>
                {f.fit.score !== null ? `${f.fit.score} · ` : ''}
                {f.fit.label}
              </p>
            </div>
            {f.fit.reasons.length ? <p className="mt-1 text-[13px] text-ink-2">{f.fit.reasons.slice(0, 2).join('. ')}.</p> : null}
            {f.fit.unknowns.length ? (
              <p className="mt-1 text-[12.5px] text-ink-3">
                <Missing label="Not counted:" className="mr-1 text-[12.5px]" />
                {f.fit.unknowns.slice(0, 3).join('; ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
