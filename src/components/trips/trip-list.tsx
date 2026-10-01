/**
 * Trips list: the next trip as a feature (dates, resorts, party, budget, bookings, checklist), later trips as an
 * editorial list, and past / cancelled trips folded away. Budget figures are the itemised budget's: a total only when
 * every item is priced, otherwise "Incomplete" with what is known.
 */
import Link from 'next/link'
import { ArrowRight, CalendarPlus, ChevronRight, Route, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { TopoArt } from '@/components/ui/topo'
import { KindTag } from '@/components/ui/provenance'
import { ButtonLink } from '@/components/ui/button'
import type { TripRowView, TripsPage } from '@/lib/data/trip-plan'
import { formatLocalDate } from '@/lib/domain/time'
import { TripStatusBadge } from './bits'
import { countdown, icsUrl, plural, rangeText, tripDateLabel } from './format'
import { Rise } from './rise'
import { NewTripButton } from './new-trip-sheet'

function DateBlock({ start, end, large }: { start: string; end: string; large?: boolean }) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const big = large ? 'text-[44px]' : start !== end && start.slice(0, 7) === end.slice(0, 7) ? 'text-[24px] md:text-[30px]' : 'text-[30px]'
  return (
    <div className="leading-none">
      <p className={cn('font-display text-ink tnum', big)}>
        {start === end ? formatLocalDate(start, 'd') : sameMonth ? `${formatLocalDate(start, 'd')}–${formatLocalDate(end, 'd')}` : formatLocalDate(start, 'd')}
      </p>
      <p className="mt-1.5 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {start === end ? `${formatLocalDate(start, 'ccc')} · ${formatLocalDate(start, 'LLL')}` : sameMonth ? formatLocalDate(start, 'LLL yyyy') : `${formatLocalDate(start, 'LLL')} – ${formatLocalDate(end, 'd LLL')}`}
      </p>
    </div>
  )
}

function whoWhere(t: TripRowView): string {
  return [
    `${plural(t.days, 'day')}${t.skiDays ? `, ${t.skiDays} on snow` : ''}`,
    `party of ${t.partySize}`,
    t.originAirport ? `from ${t.originAirport}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function BudgetFigure({ t, large }: { t: TripRowView; large?: boolean }) {
  const g = t.glance
  if (!g.lines) return <p className="text-[13px] text-ink-3 italic">No costs yet</p>
  return g.complete && g.perPerson ? (
    <div>
      <p className={cn('font-semibold text-ink tnum', large ? 'font-display text-[30px] leading-none font-semibold' : 'text-[15px]')}>{rangeText(g.perPerson)}</p>
      <p className="text-[12.5px] text-ink-3">per person · {rangeText(g.total)} total</p>
    </div>
  ) : (
    <div>
      <p className={cn('text-ink-2', large ? 'font-display text-[26px] leading-none' : 'text-[14px] font-medium')}>Incomplete estimate</p>
      <p className="text-[12.5px] text-ink-3 tnum">
        <span className="whitespace-nowrap">{g.known.max.amountMinor > 0 ? `${rangeText(g.knownPerPerson)} pp known` : 'Nothing priced yet'}</span> · <span className="whitespace-nowrap">{g.missing + g.unconverted} to price</span>
      </p>
    </div>
  )
}

function Progress({ t }: { t: TripRowView }) {
  const total = t.itemCount || 1
  if (!t.itemCount) return <p className="text-[12.5px] text-ink-3">Nothing planned yet{t.checklist.total ? ` · checklist ${t.checklist.done}/${t.checklist.total}` : ''}</p>
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="flex h-1.5 w-16 gap-[2px] overflow-hidden rounded-full bg-surface-3">
          <span className="h-full rounded-full bg-positive" style={{ width: `${(t.bookedCount / total) * 100}%` }} />
        </span>
        <span className="tnum">
          {t.bookedCount} of {t.itemCount} booked
        </span>
      </span>
      {t.checklist.total ? (
        <span className="tnum">
          checklist {t.checklist.done}/{t.checklist.total}
        </span>
      ) : null}
    </div>
  )
}

function NextUp({ t, today, demo }: { t: TripRowView; today: string; demo: boolean }) {
  return (
    <section aria-labelledby="next-up-title" className="relative overflow-hidden rounded-[14px] border border-divider bg-surface">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] opacity-80 md:block [mask-image:linear-gradient(to_left,black_55%,transparent)]">
        <TopoArt seed={t.id} density={0.9} />
      </div>
      <div className="relative grid gap-6 p-5 md:grid-cols-[112px_minmax(0,1fr)] md:gap-8 md:p-7">
        <DateBlock start={t.startDate} end={t.endDate} large />
        <div className="min-w-0">
          <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Next up · {countdown(t, today)}</span>
            <TripStatusBadge status={t.status} />
            {demo ? <KindTag kind="demo" className="tracking-normal normal-case" /> : null}
          </p>
          <h2 id="next-up-title" className="mt-2 font-display text-[32px] leading-[1.02] text-ink md:text-[40px]">
            <Link href={`/trips/${t.id}`} className="underline-offset-4 hover:text-teal hover:underline">
              {t.name}
            </Link>
          </h2>
          <p className="mt-2 text-[14.5px] text-ink-2">
            {t.resorts.length ? <span className="font-medium text-ink">{t.resorts.map((r) => r.name).join(' + ')}</span> : <span className="text-ink-3">No resort yet</span>} · {tripDateLabel(t.startDate, t.endDate)} · {whoWhere(t)}
          </p>
          <dl className="mt-5 grid max-w-[640px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <dt className="eyebrow mb-1">Budget</dt>
              <dd>
                <BudgetFigure t={t} large />
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1">Booked</dt>
              <dd className="text-[15px] font-semibold text-ink tnum">
                {t.bookedCount} <span className="font-normal text-ink-3">of {t.itemCount}</span>
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1">Checklist</dt>
              <dd className="text-[15px] font-semibold text-ink tnum">{t.checklist.total ? `${t.checklist.done} of ${t.checklist.total}` : <span className="font-normal text-ink-3">—</span>}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ButtonLink href={`/trips/${t.id}`} variant="primary" className="h-11 md:h-10">
              Open trip <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
            <a href={icsUrl(t.id)} download className="inline-flex h-11 items-center gap-2 rounded-md px-2 text-[14px] font-medium text-teal hover:underline md:h-10">
              <CalendarPlus aria-hidden className="size-4" /> Export .ics
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function TripLine({ t, today, demo, index }: { t: TripRowView; today: string; demo: boolean; index: number }) {
  return (
    <Rise as="li" index={index}>
      <Link
        href={`/trips/${t.id}`}
        className="group grid grid-cols-[64px_minmax(0,1fr)_20px] items-start gap-x-4 gap-y-2 px-4 py-4 transition-colors duration-150 hover:bg-surface-2 md:grid-cols-[88px_minmax(0,1fr)_minmax(200px,auto)_20px] md:items-center md:px-5"
      >
        <DateBlock start={t.startDate} end={t.endDate} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[16px] leading-snug font-semibold text-ink group-hover:text-teal">{t.name}</span>
            <TripStatusBadge status={t.status} />
            {demo ? <KindTag kind="demo" /> : null}
          </p>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {t.resorts.length ? t.resorts.map((r) => r.name).join(' + ') : <span className="text-ink-3">No resort yet</span>} · {whoWhere(t)}
          </p>
          <div className="mt-1.5">
            <Progress t={t} />
          </div>
        </div>
        <ChevronRight aria-hidden className="col-start-3 row-start-1 mt-1 size-5 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-teal md:col-start-4 md:mt-0" />
        <div className="col-start-2 md:col-start-3 md:row-start-1 md:text-right">
          <BudgetFigure t={t} />
          <p className="mt-0.5 text-[12.5px] text-ink-3 tnum">{countdown(t, today)}</p>
        </div>
      </Link>
    </Rise>
  )
}

export function TripsOverview({ data }: { data: TripsPage }) {
  const [next, ...later] = data.upcoming
  const s = data.stats
  const favorites = data.picker.filter((r) => r.favorite).slice(0, 3)

  if (!data.upcoming.length && !data.past.length && !data.cancelled.length) {
    return (
      <div className="flex flex-col gap-8">
        <section aria-labelledby="empty-title" className="relative overflow-hidden rounded-[14px] border border-dashed border-divider-strong bg-surface-2">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
            <TopoArt seed="trips-empty" density={0.8} />
          </div>
          <div className="relative mx-auto flex max-w-[640px] flex-col items-center px-6 py-10 text-center md:py-14">
            <span aria-hidden className="flex size-12 items-center justify-center rounded-full border border-divider bg-surface text-teal">
              <Route className="size-6" strokeWidth={1.6} />
            </span>
            <h2 id="empty-title" className="mt-4 font-display text-[30px] leading-tight text-ink md:text-[34px]">
              No trips yet
            </h2>
            <p className="mt-2 max-w-[52ch] text-[15px] text-ink-2">Pick dates and a resort to start. Piste lays out each day, compares how to get there from {data.home}, and keeps an itemised budget and checklist as you add to it.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <NewTripButton>Plan a trip</NewTripButton>
            </div>
            {favorites.length ? (
              <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[13.5px] text-ink-2">
                <span>Or start from a favourite:</span>
                {favorites.map((r) => (
                  <Link key={r.id} href={`/trips?new=1&resort=${r.id}`} scroll={false} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider-strong bg-surface px-3 font-medium text-ink hover:border-teal hover:text-teal">
                    <Star aria-hidden className="size-3.5 text-copper" fill="currentColor" /> {r.name}
                  </Link>
                ))}
              </p>
            ) : null}
          </div>
        </section>
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            ['Dates and resorts', 'A ski day is laid out for each date you choose, with pass access and — once in range — conditions.'],
            ['Travel, stay and extras', `Drive or fly: ITH and nearby airports compared door to door. Hotels, lessons, rentals and events from the catalog or your own.`],
            ['Budget and checklist', 'Your estimates, quotes and actuals itemised per person and for the group. Nothing is booked or priced for you.'],
          ].map(([title, body], k) => (
            <li key={title} className="border-t border-divider-strong pt-4">
              <p className="font-mono text-[12px] text-ink-3 tnum">0{k + 1}</p>
              <p className="mt-1 text-[16px] font-semibold text-ink">{title}</p>
              <p className="mt-1 text-[14px] text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      {data.upcoming.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-divider py-4 md:grid-cols-4">
          <div>
            <dt className="eyebrow">Upcoming</dt>
            <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{s.upcoming}</dd>
          </div>
          <div>
            <dt className="eyebrow">Ski days planned</dt>
            <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{s.skiDays}</dd>
          </div>
          <div>
            <dt className="eyebrow">Booked</dt>
            <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">
              {s.bookedItems}
              <span className="ml-1.5 font-sans text-[13px] font-normal text-ink-3">of {s.bookedItems + s.openItems} items</span>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Known spend</dt>
            <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{rangeText(s.known) ?? '—'}</dd>
            {s.incompleteTrips ? <dd className="mt-1 text-[12.5px] text-ink-3">{plural(s.incompleteTrips, 'trip')} still incomplete</dd> : null}
          </div>
        </dl>
      ) : null}

      {next ? (
        <Rise>
          <NextUp t={next} today={data.today} demo={data.demo} />
        </Rise>
      ) : null}

      {later.length ? (
        <section aria-labelledby="later-title">
          <h2 id="later-title" className="mb-3 text-[17px] font-semibold text-ink">
            Later this season
          </h2>
          <ol className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
            {later.map((t, k) => (
              <TripLine key={t.id} t={t} today={data.today} demo={data.demo} index={k + 1} />
            ))}
          </ol>
        </section>
      ) : null}

      {!data.upcoming.length ? (
        <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[15px] font-semibold text-ink">Nothing coming up</p>
            <p className="text-[13.5px] text-ink-2">Plan the next one from dates and a resort.</p>
          </div>
          <NewTripButton />
        </div>
      ) : null}

      {data.past.length ? <Folded title="Past trips" trips={data.past} today={data.today} demo={data.demo} /> : null}
      {data.cancelled.length ? <Folded title="Cancelled" trips={data.cancelled} today={data.today} demo={data.demo} /> : null}
    </div>
  )
}

function Folded({ title, trips, today, demo }: { title: string; trips: TripRowView[]; today: string; demo: boolean }) {
  return (
    <details className="group rounded-[12px] border border-divider bg-surface [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:px-5">
        <span className="text-[15px] font-semibold text-ink">
          {title} <span className="font-normal text-ink-3 tnum">{trips.length}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 text-ink-3 transition-transform duration-150 group-open:rotate-90" />
      </summary>
      <ol className="divide-y divide-divider border-t border-divider">
        {trips.map((t, k) => (
          <TripLine key={t.id} t={t} today={today} demo={demo} index={k + 9} />
        ))}
      </ol>
    </details>
  )
}
