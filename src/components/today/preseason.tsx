/**
 * Preseason hero — what "Where to ski" says before any resort has opened: there is no pick and no score (nothing is
 * ranked that is not open), when the first openings are expected (announced targets and Piste estimates kept
 * apart), and the opening watch itself. No fake scores, no "best day" for a closed mountain.
 */
import { TopoArt } from '@/components/ui/topo'
import type { OpeningTimelineItem } from '@/lib/data/today'
import { countdown, openingDates } from './format'
import { LongHaulNote } from './long-haul'
import { OpeningTimeline } from './opening-timeline'
import { formatDates } from './params'

function first(items: OpeningTimelineItem[], label: 'announced' | 'estimated', today: string) {
  return items.filter((o) => o.label === label && o.date && (o.to ?? o.date) >= today).sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null
}

export function PreseasonHero({
  items,
  today,
  dates,
  seasonLabel,
  reason,
  longHaul = 0,
  longHaulLimit = null,
}: {
  items: OpeningTimelineItem[]
  today: string
  dates: string[]
  seasonLabel: string
  reason: string | null
  /** Resorts more than a long flight from home: not part of this answer (planned as trips). */
  longHaul?: number
  longHaulLimit?: string | null
}) {
  const announced = first(items, 'announced', today)
  const estimated = first(items, 'estimated', today)
  const counts = {
    announced: items.filter((o) => o.label === 'announced').length,
    estimated: items.filter((o) => o.label === 'estimated').length,
    none: items.filter((o) => o.label === 'not-announced' || !o.date).length,
  }
  const lead = [
    announced
      ? `The first announced opening is ${announced.name} on ${openingDates('announced', announced.date, null)} (${countdown(announced.daysAway)}) — a target, subject to conditions.`
      : 'No resort has announced its opening date yet.',
    estimated
      ? `${announced ? 'The earliest' : 'The earliest date on record is a'} Piste estimate${announced ? ' is' : ':'} ${estimated.name}, ${openingDates('estimated', estimated.date, estimated.to)}, from past seasons’ openings.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <section aria-labelledby="where-title" className="overflow-hidden rounded-[14px] border border-divider bg-surface">
      <div className="relative border-b border-divider px-4 pt-4 pb-5 md:px-6 md:pt-5">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[55%] opacity-60 max-md:hidden">
          <TopoArt seed="opening-watch" density={0.55} />
        </div>
        <div className="relative">
          <p className="eyebrow mb-1">Where to ski · {formatDates(dates)}</p>
          <h2 id="where-title" className="font-display text-[34px] leading-[1.02] text-ink md:text-[44px]">
            Nothing is open yet
          </h2>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-2">
            No resort has reported opening for {seasonLabel}, so there is no pick and no conditions score — Piste only ranks resorts that are reported open.{' '}
            <span className="text-ink">{lead}</span>
          </p>
          {reason ? <p className="sr-only">{reason}</p> : null}
          <LongHaulNote count={longHaul} limit={longHaulLimit} what="part of this answer" className="mt-2 max-w-[62ch]" />
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Announced</dt>
              <dd className="font-display tnum text-[30px] leading-none text-teal">{counts.announced}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Piste estimates</dt>
              <dd className="font-display tnum text-[30px] leading-none text-copper">{counts.estimated}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">No date yet</dt>
              <dd className="font-display tnum text-[30px] leading-none text-ink-2">{counts.none}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="px-4 pt-4 pb-3 md:px-6">
        <h3 className="text-[17px] leading-snug font-semibold text-ink">Opening watch</h3>
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          An announced date is a target, never “open” until an opening is reported. Estimates are Piste’s, from past seasons.
        </p>
        <OpeningTimeline items={items} today={today} variant="preseason" className="mt-3" />
      </div>
    </section>
  )
}
