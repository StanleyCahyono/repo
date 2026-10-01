/**
 * Where I skied this season (server-rendered list): days per resort with a proportional bar, pass days, first and
 * last visit, the average of my day ratings and my overall rating of the resort. Every figure is also text.
 */
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import type { DestinationView } from '@/lib/data/season'
import { formatLocalDate } from '@/lib/domain/time'
import { plural, resortHref } from './format'

export function Destinations({ destinations, home }: { destinations: DestinationView[]; home: string }) {
  const most = Math.max(1, ...destinations.map((d) => d.days))
  return (
    <section aria-labelledby="destinations-title" className="rounded-[12px] border border-divider bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
        <h3 id="destinations-title" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <MapPin aria-hidden className="size-4 text-ink-2" /> Destinations
        </h3>
        <span className="text-[12.5px] text-ink-3 tnum">{plural(destinations.length, 'resort')}</span>
      </header>
      {destinations.length ? (
        <ol className="divide-y divide-divider">
          {destinations.map((d) => (
            <li key={d.resortId} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={resortHref(d.resortId)} className="min-w-0 text-[14.5px] font-semibold text-ink underline-offset-4 hover:text-teal hover:underline">
                  {d.name}
                </Link>
                <span className="shrink-0 font-display text-[22px] leading-none text-ink tnum">
                  {d.days}
                  <span className="ml-1 font-sans text-[12.5px] font-normal text-ink-3">{d.days === 1 ? 'day' : 'days'}</span>
                </span>
              </div>
              <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-teal" style={{ width: `${(d.days / most) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink-3 tnum">
                {[
                  d.region,
                  d.firstDate === d.lastDate ? formatLocalDate(d.firstDate, 'd LLL') : `${formatLocalDate(d.firstDate, 'd LLL')} – ${formatLocalDate(d.lastDate, 'd LLL')}`,
                  d.passDays ? `${d.passDays} on a pass` : null,
                  d.avgDayRating != null ? `days rated ${d.avgDayRating.toFixed(1)}/5` : null,
                  d.myRating != null ? `my rating ${d.myRating}/5` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-4 text-[13.5px] text-ink-2">Resorts you ski this season appear here — how often you went, and how the days rated. Trips start from {home}.</p>
      )}
    </section>
  )
}
