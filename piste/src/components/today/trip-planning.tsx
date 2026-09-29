/**
 * Next saved trip (or the one in progress) with its dates, status, bookings and budget — the budget is a range or
 * "known so far + N to price", never a made-up total. Below it, planning hints: the first weekend after a
 * favourite's announced or estimated opening, deep-linked to the new-trip sheet (nothing is created until you save).
 */
import Link from 'next/link'
import { ArrowRight, CalendarPlus, Route } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { TripStatusBadge } from '@/components/trips/bits'
import type { TripSummary } from '@/lib/data/trips'
import { formatMoneyRange } from '@/lib/domain/money'
import { daysBetween, formatLocalDate } from '@/lib/domain/time'
import { countdown, plural } from './format'
import type { PlanningHint } from './data'
import { formatDates } from './params'
import { Block, Label } from './section'

function tripDates(t: Pick<TripSummary, 'startDate' | 'endDate'>) {
  return formatDates(t.startDate === t.endDate ? [t.startDate] : [t.startDate, t.endDate])
}

function Budget({ b }: { b: TripSummary['budget'] }) {
  if (b.complete && b.total) return <span className="tnum">{formatMoneyRange(b.total.min, b.total.max)}</span>
  const known = formatMoneyRange(b.knownGroup.min, b.knownGroup.max)
  return (
    <span>
      <span className="tnum">{known ?? 'Nothing priced'}</span>
      {b.missingCount ? <span className="text-ink-3"> known · {plural(b.missingCount, 'item')} to price</span> : null}
    </span>
  )
}

export function TripPlanning({ trips, planning, today }: { trips: TripSummary[]; planning: PlanningHint[]; today: string }) {
  const next = trips.find((t) => t.phase === 'in-progress') ?? trips[0] ?? null
  const later = trips.filter((t) => t !== next)
  return (
    <Block
      id="trip-title"
      eyebrow={next ? (next.phase === 'in-progress' ? 'Trip in progress' : 'Next trip') : 'Trip planning'}
      title={next ? 'Your next saved trip' : 'No trip saved yet'}
      actions={
        <Link href="/trips" className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-teal hover:bg-glacier/60 md:h-9">
          All trips <ArrowRight aria-hidden className="size-4" />
        </Link>
      }
    >
      {next ? (
        <div className="flex gap-4">
          <div aria-hidden className="w-14 shrink-0 text-center">
            <p className="font-display tnum text-[34px] leading-none text-ink">{formatLocalDate(next.startDate, 'd')}</p>
            <p className="mt-1 text-[12px] leading-tight font-semibold tracking-[0.06em] text-ink-3 uppercase">
              {formatLocalDate(next.startDate, 'ccc')}
              <br />
              {formatLocalDate(next.startDate, 'LLL')}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <TripStatusBadge status={next.status} />
              <span className="tnum">{next.phase === 'in-progress' ? 'under way' : countdown(next.daysUntil)}</span>
            </p>
            <h3 className="mt-1 font-display text-[26px] leading-[1.05] text-ink">
              <Link href={`/trips/${next.id}`} className="rounded-sm hover:text-teal hover:underline">
                {next.name}
              </Link>
            </h3>
            <p className="mt-1 text-[13.5px] text-ink-2">
              <span className="tnum">{tripDates(next)}</span>
              {next.resorts.length ? ` · ${next.resorts.map((r) => r.name).join(', ')}` : ' · no resort yet'} · party of {next.partySize}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px]">
              <div>
                <dt className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Budget</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  <Budget b={next.budget} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Booked</dt>
                <dd className="tnum mt-0.5 font-medium text-ink">
                  {next.bookedCount} <span className="font-normal text-ink-3">of {plural(next.itemCount, 'item')}</span>
                </dd>
              </div>
            </dl>
            <ButtonLink href={`/trips/${next.id}`} variant="primary" className="mt-4 h-11 md:h-10">
              Open trip <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
          </div>
        </div>
      ) : (
        <p className="text-[14px] text-ink-2">
          Save a draft from a recommendation, or start one from dates and a resort — nothing is booked until you say so.{' '}
          <Link href="/trips?new=1" className="font-medium text-teal hover:underline">
            Start a trip
          </Link>
        </p>
      )}

      {later.length ? (
        <p className="mt-4 border-t border-divider pt-3 text-[13px] text-ink-2">
          Later:{' '}
          {later.slice(0, 3).map((t, i) => (
            <span key={t.id}>
              {i ? ' · ' : ''}
              <Link href={`/trips/${t.id}`} className="font-medium text-ink hover:text-teal hover:underline">
                {t.name}
              </Link>{' '}
              <span className="tnum text-ink-3">{tripDates(t)}</span>
            </span>
          ))}
          {later.length > 3 ? ` · +${later.length - 3} more` : ''}
        </p>
      ) : null}

      {planning.length ? (
        <div className="mt-4 border-t border-divider pt-3">
          <Label as="h3">Plan around openings</Label>
          <ul className="mt-2 flex flex-col gap-2">
            {planning.map((h) => (
              <li key={h.resortId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-[13.5px] text-ink-2">
                  <span className="font-medium text-ink">{h.name}</span> — first weekend after the {h.label === 'announced' ? 'announced' : 'estimated'}{' '}
                  opening: <span className="tnum font-medium text-ink">{formatDates([h.from, h.to])}</span>
                  {h.from > today ? <span className="tnum text-ink-3"> · {countdown(daysBetween(today, h.from))}</span> : null}
                </p>
                <Link
                  href={h.href}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-divider-strong bg-surface px-3 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:border-teal hover:text-teal md:h-9"
                >
                  <CalendarPlus aria-hidden className="size-4" /> Draft a trip
                  <span className="sr-only"> to {h.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-ink-3">
            <Route aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Opening dates move with weather and snowmaking — an estimate is Piste’s, not the resort’s. Keep early bookings refundable.
          </p>
        </div>
      ) : null}
    </Block>
  )
}
