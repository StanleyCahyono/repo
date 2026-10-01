/**
 * Trips list (Glass HUD): a HUD stat strip, the next trip as a feature card, later trips as glass cards that lift on
 * hover, and past / cancelled trips folded away. Budget figures are the itemised budget's: a total only when every
 * item is priced, otherwise "Incomplete" with what is known.
 *
 * First run: no trips is the real state, so it is designed — a "where to first?" panel (favourites carry their real
 * season dates), and a blank trip card that shows the fields a trip fills in, never an invented trip.
 */
import Link from 'next/link'
import { ArrowRight, CalendarPlus, ChevronRight, Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { TopoArt } from '@/components/ui/topo'
import { KindTag } from '@/components/ui/provenance'
import type { PickerResort, TripRowView, TripsPage } from '@/lib/data/trip-plan'
import { formatLocalDate } from '@/lib/domain/time'
import { TripStatusBadge } from './bits'
import { countdown, icsUrl, plural, rangeText, tripDateLabel } from './format'
import { Rise } from './rise'
import { NewTripButton } from './new-trip-sheet'
import { GrowBar } from './hud-bits'
import { SeasonMark } from './range-calendar'
import { bandSegment, monthGrid } from './calendar-model'

/** Read-only month with the trip's range drawn on it (decorative beside the dates in text). */
function MiniMonth({ start, end, today }: { start: string; end: string; today: string }) {
  const ym = start.slice(0, 7)
  const weeks = monthGrid(ym)
  return (
    <div aria-hidden className="glass-strong w-[272px] rounded-[24px] p-4">
      <p className="mb-2 flex items-baseline justify-between text-[13px] font-semibold text-ink">
        {formatLocalDate(`${ym}-01`, 'LLLL yyyy')}
        {end.slice(0, 7) !== ym ? <span className="hud text-[11px] text-ink-2">continues →</span> : null}
      </p>
      <div className="grid grid-cols-7 pb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className={cn('text-center font-mono text-[11px]', i >= 5 ? 'text-teal' : 'text-ink-3')}>
            {d}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        {weeks.map((w, wi) => {
          const seg = bandSegment(w, start, end)
          return (
            <div key={wi} className="relative grid grid-cols-7">
              {seg ? <span className="absolute inset-y-0 rounded-full bg-teal/15" style={{ left: `calc(${(seg.c0 / 7) * 100}% + 1px)`, width: `calc(${((seg.c1 - seg.c0 + 1) / 7) * 100}% - 2px)` }} /> : null}
              {w.map((d, i) => (
                <span key={i} className={cn('relative mx-auto flex size-8 items-center justify-center rounded-full text-[12px] tnum', d && (d === start || d === end) ? 'bg-ink-chip font-semibold text-on-ink-chip' : d && d < today ? 'text-ink-3' : 'text-ink')}>
                  {d ? Number(d.slice(8)) : ''}
                </span>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DateBlock({ start, end, large }: { start: string; end: string; large?: boolean }) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return (
    <div className="leading-none">
      <p className={cn('font-light tracking-[-0.04em] whitespace-nowrap text-ink tnum', large ? 'text-[56px] md:text-[72px]' : 'text-[34px]')}>
        {start === end ? formatLocalDate(start, 'd') : sameMonth ? `${formatLocalDate(start, 'd')}–${formatLocalDate(end, 'd')}` : formatLocalDate(start, 'd LLL')}
      </p>
      <p className="hud mt-2 text-ink-2">
        {start === end ? `${formatLocalDate(start, 'ccc')} · ${formatLocalDate(start, 'LLL yyyy')}` : sameMonth ? formatLocalDate(start, 'LLL yyyy') : `→ ${formatLocalDate(end, 'd LLL yyyy')}`}
      </p>
    </div>
  )
}

function whoWhere(t: TripRowView): string {
  return [`${plural(t.days, 'day')}${t.skiDays ? `, ${t.skiDays} on snow` : ''}`, `party of ${t.partySize}`, t.originAirport ? `from ${t.originAirport}` : null].filter(Boolean).join(' · ')
}

function BudgetFigure({ t, large }: { t: TripRowView; large?: boolean }) {
  const g = t.glance
  if (!g.lines) return <p className={cn('text-ink-2', large ? 'text-[24px] leading-none font-light tracking-[-0.02em]' : 'text-[14px] font-medium')}>No costs yet</p>
  return g.complete && g.perPerson ? (
    <div>
      <p className={cn('text-ink tnum', large ? 'text-[32px] leading-none font-light tracking-[-0.03em]' : 'text-[15px] font-semibold')}>{rangeText(g.perPerson)}</p>
      <p className="mt-1 text-[12.5px] text-ink-2">per person · {rangeText(g.total)} total</p>
    </div>
  ) : (
    <div>
      <p className={cn('text-ink-2', large ? 'text-[24px] leading-none font-light tracking-[-0.02em]' : 'text-[14px] font-medium')}>Incomplete</p>
      <p className="mt-1 text-[12.5px] text-ink-2 tnum">
        <span className="whitespace-nowrap">{g.known.max.amountMinor > 0 ? `${rangeText(g.knownPerPerson)} pp known` : 'Nothing priced yet'}</span> · <span className="whitespace-nowrap">{g.missing + g.unconverted} to price</span>
      </p>
    </div>
  )
}

function Meters({ t }: { t: TripRowView }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
      <div>
        <dt className="hud flex justify-between gap-2 text-ink-2">
          Booked <span className="text-ink tnum">{t.itemCount ? `${t.bookedCount}/${t.itemCount}` : '—'}</span>
        </dt>
        <dd className="mt-1.5">
          <GrowBar low={t.itemCount ? t.bookedCount / t.itemCount : 0} />
        </dd>
      </div>
      <div>
        <dt className="hud flex justify-between gap-2 text-ink-2">
          Checklist <span className="text-ink tnum">{t.checklist.total ? `${t.checklist.done}/${t.checklist.total}` : '—'}</span>
        </dt>
        <dd className="mt-1.5">
          <GrowBar low={t.checklist.total ? t.checklist.done / t.checklist.total : 0} delay={0.08} />
        </dd>
      </div>
    </dl>
  )
}

function NextUp({ t, today, demo }: { t: TripRowView; today: string; demo: boolean }) {
  return (
    <section aria-labelledby="next-up-title" className="glass group relative overflow-hidden rounded-[32px] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--glass-shadow-lg)]">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[60%] opacity-90 [mask-image:linear-gradient(to_left,black_45%,transparent)] max-md:hidden">
        <TopoArt seed={t.resorts[0]?.id ?? t.id} density={1} />
      </div>
      <div className="pointer-events-none absolute top-1/2 right-8 hidden -translate-y-1/2 rotate-[-2deg] transition-transform duration-300 group-hover:rotate-0 xl:block">
        <MiniMonth start={t.startDate} end={t.endDate} today={today} />
      </div>
      <div className="relative grid gap-6 p-6 md:grid-cols-[minmax(0,auto)_minmax(0,1fr)] md:gap-10 md:p-8 xl:pr-[340px]">
        <DateBlock start={t.startDate} end={t.endDate} large />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="hud tracking-[0.16em] text-teal">Next up · {countdown(t, today)}</span>
            <TripStatusBadge status={t.status} />
            {demo ? <KindTag kind="demo" /> : null}
          </p>
          <h2 id="next-up-title" className="mt-2 text-[34px] leading-[1.02] font-light tracking-[-0.03em] text-ink md:text-[44px]">
            <Link href={`/trips/${t.id}`} className="outline-offset-4 after:absolute after:inset-0 after:content-['']">
              {t.name}
            </Link>
          </h2>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
            {t.resorts.length ? (
              t.resorts.map((r) => (
                <span key={r.id} className="inline-flex min-h-8 items-center rounded-full bg-ink-chip px-3 text-[13px] font-medium text-on-ink-chip">
                  {r.name}
                </span>
              ))
            ) : (
              <span className="text-ink-3">No resort yet</span>
            )}
            <span>{whoWhere(t)}</span>
          </p>
          <div className="mt-6 grid max-w-[640px] gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <p className="hud mb-1.5 text-ink-2">Budget</p>
              <BudgetFigure t={t} large />
            </div>
            <Meters t={t} />
          </div>
          <div className="relative z-[1] mt-7 flex flex-wrap items-center gap-3">
            <Link href={`/trips/${t.id}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-chip px-5 text-[14.5px] font-medium text-on-ink-chip transition-colors duration-150 hover:bg-teal hover:text-on-teal">
              Open planner <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            </Link>
            <a href={icsUrl(t.id)} download className="glass-strong inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink hover:text-teal">
              <CalendarPlus aria-hidden className="size-4" /> Export .ics
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function TripCard({ t, today, demo, index }: { t: TripRowView; today: string; demo: boolean; index: number }) {
  return (
    <Rise as="li" index={index} className="min-w-0">
      <Link
        href={`/trips/${t.id}`}
        className="glass group flex h-full flex-col gap-4 rounded-[28px] p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--glass-shadow-lg)] md:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <DateBlock start={t.startDate} end={t.endDate} />
          <span className="flex flex-col items-end gap-1.5">
            <TripStatusBadge status={t.status} />
            {demo ? <KindTag kind="demo" /> : null}
          </span>
        </div>
        <div className="min-w-0">
          <p className="hud text-teal">{countdown(t, today)}</p>
          <p className="mt-1 text-[20px] leading-snug font-normal tracking-[-0.01em] text-ink group-hover:text-teal">{t.name}</p>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {t.resorts.length ? t.resorts.map((r) => r.name).join(' + ') : <span className="text-ink-3">No resort yet</span>} · {whoWhere(t)}
          </p>
        </div>
        <Meters t={t} />
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-divider pt-3">
          <BudgetFigure t={t} />
          <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-teal" />
        </div>
      </Link>
    </Rise>
  )
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="glass rounded-[24px] px-5 py-4">
      <dt className="hud text-ink-2">{label}</dt>
      <dd className="mt-1.5 text-[34px] leading-none font-light tracking-[-0.03em] text-ink tnum">{value}</dd>
      {sub ? <dd className="mt-1.5 text-[12.5px] text-ink-2">{sub}</dd> : null}
    </div>
  )
}

function seasonHint(r: PickerResort): React.ReactNode {
  const w = r.seasons[0]
  if (!w) return <span className="text-ink-3">opening not announced</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeasonMark kind={w.kind} className="w-3" />
      {w.kind === 'estimate' ? 'est.' : w.kind === 'announced' ? 'from' : 'opened'} {formatLocalDate(w.from, 'd LLL')}
    </span>
  )
}

/** First run: no trips yet. */
function FirstRun({ data }: { data: TripsPage }) {
  const favorites = data.picker.filter((r) => r.favorite).slice(0, 4)
  const fields: [string, string][] = [
    ['Dates', 'Tap a start and an end day'],
    ['Resort', 'One or several, day by day'],
    ['Getting there', `Drive or fly from ${data.home.split(',')[0]} (ITH, SYR, ELM, ROC, BUF)`],
    ['Stay', 'Lodging you are considering'],
    ['Budget · per person', 'Your estimates, quotes and actuals'],
    ['Checklist', data.templateCount ? `${plural(data.templateCount, 'template item')} ready` : 'Gear, bookings, the day itself'],
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Rise index={1}>
          <section aria-labelledby="first-title" className="glass relative flex h-full min-h-[380px] flex-col justify-end overflow-hidden rounded-[32px] p-6 md:p-8">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-90 [mask-image:linear-gradient(to_bottom,black_30%,transparent_85%)]">
              <TopoArt seed="trips-first-run" density={1.1} />
            </div>
            <div className="relative">
              <p className="hud tracking-[0.16em] text-teal">First trip</p>
              <h2 id="first-title" className="mt-2 text-[40px] leading-[1] font-light tracking-[-0.04em] text-ink md:text-[52px]">
                Where to first?
              </h2>
              <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
                Pick a resort and tap your dates on the calendar. Piste lays out each day, compares driving with flying from {data.home}, and keeps an itemised budget and checklist as you add to it.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <NewTripButton className="h-11">Plan a trip</NewTripButton>
              </div>
              {favorites.length ? (
                <div className="mt-5">
                  <p className="hud mb-2 text-ink-2">Or start from a favourite</p>
                  <ul className="flex flex-wrap gap-2">
                    {favorites.map((r) => (
                      <li key={r.id} className="max-w-full">
                        <Link href={`/trips?new=1&resort=${r.id}`} scroll={false} className="glass-strong inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full py-1.5 pr-4 pl-3 text-[13.5px] transition-transform duration-150 hover:-translate-y-0.5">
                          <Star aria-hidden className="size-3.5 shrink-0 text-copper" fill="currentColor" />
                          <span className="truncate font-medium text-ink">{r.shortName || r.name}</span>
                          <span className="shrink-0 text-[12.5px] text-ink-2">{seasonHint(r)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        </Rise>
        <Rise index={2}>
          <section aria-labelledby="blank-title" className="glass flex h-full flex-col rounded-[32px] p-6 md:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="blank-title" className="hud m-0 text-ink-2">
                Your trip card
              </h2>
              <span className="hud text-copper">Fills in as you plan</span>
            </div>
            <p className="mt-1 text-[13px] text-ink-3">What every trip keeps track of — empty until you add it.</p>
            <dl className="mt-4 flex flex-1 flex-col">
              {fields.map(([k, v], i) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-t border-divider py-3">
                  <dt className="flex shrink-0 items-baseline gap-3">
                    <span className="font-mono text-[12px] text-teal tnum">0{i + 1}</span>
                    <span className="text-[14.5px] font-medium text-ink">{k}</span>
                  </dt>
                  <dd className="min-w-0 text-right text-[13px] text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Rise>
      </div>
      <Rise index={3}>
        <p className="hud text-center text-ink-3">Nothing is booked from Piste · prices are only ever yours · unknown stays unknown</p>
      </Rise>
    </div>
  )
}

export function TripsOverview({ data }: { data: TripsPage }) {
  const [next, ...later] = data.upcoming
  const s = data.stats

  if (!data.upcoming.length && !data.past.length && !data.cancelled.length) return <FirstRun data={data} />

  return (
    <div className="flex flex-col gap-8">
      {data.upcoming.length ? (
        <Rise index={1}>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatTile label="Upcoming" value={s.upcoming} sub={plural(s.upcoming, 'trip')} />
            <StatTile label="Ski days planned" value={s.skiDays} />
            <StatTile label="Booked" value={s.bookedItems} sub={`of ${plural(s.bookedItems + s.openItems, 'item')}`} />
            <StatTile label="Known spend" value={s.known && s.known.max.amountMinor > 0 ? rangeText(s.known) : '—'} sub={s.incompleteTrips ? `${plural(s.incompleteTrips, 'trip')} still incomplete` : 'every item priced'} />
          </dl>
        </Rise>
      ) : null}

      {next ? (
        <Rise index={2}>
          <NextUp t={next} today={data.today} demo={data.demo} />
        </Rise>
      ) : null}

      {later.length ? (
        <section aria-labelledby="later-title">
          <h2 id="later-title" className="hud mb-3 text-ink-2">
            Later this season · {later.length}
          </h2>
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {later.map((t, k) => (
              <TripCard key={t.id} t={t} today={data.today} demo={data.demo} index={k + 3} />
            ))}
          </ol>
        </section>
      ) : null}

      {!data.upcoming.length ? (
        <div className="glass flex flex-col items-start gap-3 rounded-[28px] px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[24px] leading-tight font-light tracking-[-0.02em] text-ink">Nothing coming up</p>
            <p className="mt-1 text-[14px] text-ink-2">Plan the next one from a resort and dates.</p>
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
    <details className="glass group rounded-[28px] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 md:px-6">
        <span className="hud text-ink-2">
          {title} <span className="text-ink tnum">· {trips.length}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 text-ink-3 transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <ol className="divide-y divide-divider border-t border-divider">
        {trips.map((t) => (
          <li key={t.id}>
            <Link href={`/trips/${t.id}`} className="group/row flex min-h-14 items-center justify-between gap-4 px-5 py-3 transition-colors duration-150 hover:bg-ink/[0.03] md:px-6">
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink group-hover/row:text-teal">{t.name}</span>
                <span className="block text-[13px] text-ink-2 tnum">
                  {tripDateLabel(t.startDate, t.endDate)} · {t.resorts.map((r) => r.name).join(' + ') || 'No resort'} · {countdown(t, today)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <TripStatusBadge status={t.status} />
                {demo ? <KindTag kind="demo" /> : null}
                <ChevronRight aria-hidden className="size-4 text-ink-3" />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  )
}
