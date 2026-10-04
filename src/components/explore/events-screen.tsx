'use client'
/**
 * Explore → Events. Dated events (announced or tentative, postponed or cancelled — each clearly labelled) in a
 * month-grouped timeline or a month calendar, plus a "Watching for dates" shelf for events whose next edition has
 * no announced date. Filters: date window (upcoming, 30 days, season, a trip's dates, custom), resort, category and
 * price. All filter state is in the URL (history.replaceState, synced with useSearchParams).
 *
 * Honesty: dates are never invented or rolled forward from a previous edition; distance is only "at the resort" when
 * the venue is the resort, otherwise "not recorded"; prices show only when published; age and booking rules only
 * when stated. Add to calendar exists only for dated, non-cancelled events.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import {
  Ban,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarSearch,
  CalendarX2,
  Download,
  ExternalLink,
  Eye,
  List,
  MapPin,
} from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Select } from '@/components/ui/form'
import { DateRangePicker, type DateMark } from '@/components/ui/date-picker'
import { MonthTitle, NavButton, SlidingMonths } from '@/components/ui/date-picker-grid'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { EmptyState } from '@/components/ui/states'
import type { EventItem, EventsView } from '@/lib/data/explore'
import { formatLocalDate, relativeLabel } from '@/lib/domain/time'
import { AddEventToTrip } from './add-event-to-trip'
import { ToggleChips } from './choice-group'
import {
  PRICE_LABEL,
  WHEN_OPTION,
  eventFiltersToParams,
  eventsOn,
  groupByMonth,
  initialMonth,
  monthGrid,
  parseEventFilters,
  selectEvents,
  shiftMonth,
  windowFor,
  type EventFilters,
  type PriceKey,
  type WhenKey,
} from './events-filters'
import { readableQuery, rememberQuery } from './use-explore-url'

const STATUS_STYLE: Record<EventItem['status'], { cls: string; Icon: typeof CalendarCheck2 }> = {
  announced: { cls: 'bg-positive-bg text-positive', Icon: CalendarCheck2 },
  tentative: { cls: 'bg-caution-bg text-caution', Icon: CalendarClock },
  'not-announced': { cls: 'border border-dashed border-divider-strong bg-surface text-ink-2', Icon: CalendarSearch },
  postponed: { cls: 'bg-caution-bg text-caution', Icon: CalendarX2 },
  cancelled: { cls: 'bg-critical-bg text-critical', Icon: Ban },
}

export function EventStatus({ status, label }: { status: EventItem['status']; label: string }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium whitespace-nowrap', s.cls)}>
      <s.Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  )
}

export function EventsScreen({ view }: { view: EventsView }) {
  const sp = useSearchParams()
  const pathname = usePathname()
  const f = useMemo(() => parseEventFilters(sp), [sp])
  const setFilters = useCallback(
    (patch: Partial<EventFilters>) => {
      const cur = parseEventFilters(new URLSearchParams(window.location.search))
      const p = eventFiltersToParams({ ...cur, ...patch }, window.location.search)
      const q = readableQuery(p)
      window.history.replaceState(null, '', q ? `${pathname}?${q}` : pathname)
      rememberQuery('events', q)
    },
    [pathname],
  )
  useEffect(() => {
    rememberQuery('events', sp.toString())
  }, [sp])

  const win = useMemo(() => windowFor(f, view), [f, view])
  const sel = useMemo(() => selectEvents(view.events, f, win), [view.events, f, win])
  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of view.events) m.set(e.category, (m.get(e.category) ?? 0) + 1)
    return m
  }, [view.events])

  return (
    <div className="flex flex-col gap-5">
      <FilterPanel view={view} f={f} setFilters={setFilters} catCounts={catCounts} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p role="status" aria-live="polite" className="text-[14px] text-ink-2">
          <strong className="tnum font-semibold text-ink">{sel.dated.length}</strong> dated {sel.dated.length === 1 ? 'event' : 'events'} · {win.label}
          <span className="text-ink-3"> · </span>
          <strong className="tnum font-semibold text-ink">{sel.watching.length}</strong> watching for dates
          {view.lastVerifiedAt ? <span className="text-ink-3"> · catalog checked {relativeLabel(view.lastVerifiedAt, view.now)}</span> : null}
        </p>
        <LayoutToggle value={f.view} onChange={(v) => setFilters({ view: v, month: v === 'calendar' ? f.month : null })} />
      </div>

      {f.view === 'calendar' ? (
        <EventCalendar view={view} f={f} dated={sel.dated} win={win} onMonth={(m) => setFilters({ month: m })} />
      ) : sel.dated.length ? (
        <Timeline events={sel.dated} view={view} />
      ) : (
        <NoDated view={view} f={f} outside={sel.outside.length} onWiden={() => setFilters({ when: 'season' })} />
      )}

      <Watching events={sel.watching} view={view} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filters

function FilterPanel({
  view,
  f,
  setFilters,
  catCounts,
}: {
  view: EventsView
  f: EventFilters
  setFilters: (p: Partial<EventFilters>) => void
  catCounts: Map<string, number>
}) {
  const label = 'text-[12.5px] font-medium text-ink-2'
  // Days with dated events, drawn under the day numbers of the date picker (announced vs tentative, with text).
  const marks = useMemo<DateMark[]>(
    () =>
      view.events
        .filter((e) => e.startDate && e.status !== 'cancelled' && e.status !== 'not-announced')
        .map((e) => ({
          date: e.startDate!,
          to: e.endDate && e.endDate > e.startDate! ? e.endDate : undefined,
          label: e.status === 'announced' ? 'Event (announced)' : 'Event (tentative or postponed)',
          tone: e.status === 'announced' ? ('positive' as const) : ('caution' as const),
          soft: e.status !== 'announced',
        })),
    [view.events],
  )
  return (
    <section aria-labelledby="events-filters" className="glass rounded-[24px] p-4 md:px-6 md:py-5">
      <h2 id="events-filters" className="sr-only">
        Filter events
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
          <label htmlFor="ev-when" className={label}>
            When
          </label>
          <Select
            id="ev-when"
            value={f.when}
            onChange={(e) => {
              const when = e.target.value as WhenKey
              // Picking "During a trip" starts with the next trip, so the window is never silently the default.
              setFilters(when === 'trip' ? { when, trip: f.trip ?? view.trips[0]?.id ?? null } : { when })
            }}
          >
            {(Object.keys(WHEN_OPTION) as WhenKey[]).map((k) => (
              <option key={k} value={k} disabled={k === 'trip' && !view.trips.length}>
                {WHEN_OPTION[k]}
                {k === 'trip' && !view.trips.length ? ' (no upcoming trips)' : ''}
              </option>
            ))}
          </Select>
        </div>
        {f.when === 'trip' ? (
          <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
            <label htmlFor="ev-trip" className={label}>
              Trip
            </label>
            <Select id="ev-trip" value={f.trip ?? ''} onChange={(e) => setFilters({ trip: e.target.value || null })}>
              {f.trip ? null : <option value="">Choose a trip</option>}
              {view.trips.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name} · {tr.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {f.when === 'custom' ? (
          <div className="col-span-2 flex flex-col gap-1.5 xl:col-span-1">
            <label htmlFor="ev-dates" className={label}>
              Dates
            </label>
            <DateRangePicker
              id="ev-dates"
              value={{ start: f.from ?? view.today, end: f.to ?? view.seasonBounds.max }}
              min={view.seasonBounds.min}
              max={view.seasonBounds.max}
              today={view.today}
              marks={marks}
              presets={['this-weekend', 'next-weekend', 'next-7-days']}
              onChange={(v) => v.start && v.end && setFilters({ from: v.start, to: v.end })}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ev-resort" className={label}>
            Resort
          </label>
          <Select id="ev-resort" value={f.resort ?? ''} onChange={(e) => setFilters({ resort: e.target.value || null })}>
            <option value="">All resorts</option>
            {view.resorts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ev-price" className={label}>
            Price
          </label>
          <Select id="ev-price" value={f.price} onChange={(e) => setFilters({ price: e.target.value as PriceKey })}>
            {(Object.keys(PRICE_LABEL) as PriceKey[]).map((k) => (
              <option key={k} value={k}>
                {PRICE_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {view.categories.length > 1 ? (
        <ToggleChips
          className="mt-4"
          label="Category"
          options={view.categories.map((c) => ({ value: c.id, label: c.label, count: catCounts.get(c.id) ?? 0 }))}
          values={f.cats}
          onChange={(v) => setFilters({ cats: v })}
        />
      ) : null}
    </section>
  )
}

function LayoutToggle({ value, onChange }: { value: 'list' | 'calendar'; onChange: (v: 'list' | 'calendar') => void }) {
  return (
    <div role="group" aria-label="Show events as" className="glass-strong inline-flex rounded-full p-1">
      {(
        [
          { v: 'list', label: 'List', Icon: List },
          { v: 'calendar', label: 'Calendar', Icon: CalendarDays },
        ] as const
      ).map(({ v, label, Icon }) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={cn(
              'relative inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-colors duration-150 md:h-9',
              on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
            )}
          >
            {on ? (
              <motion.span
                layoutId="events-layout"
                transition={t.select}
                aria-hidden
                className="absolute inset-0 rounded-full bg-ink-chip"
              />
            ) : null}
            <Icon aria-hidden className="relative size-4" />
            <span className="relative">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dated events

function Timeline({ events, view }: { events: EventItem[]; view: EventsView }) {
  const months = groupByMonth(events)
  return (
    <div className="flex flex-col gap-6">
      {months.map((m, i) => (
        <section
          key={m.month}
          aria-labelledby={`ev-month-${m.month}`}
          className="piste-rise"
          style={i < 4 ? ({ '--rise-delay': `${i * 60}ms` } as CSSProperties) : undefined}
        >
          <h2 id={`ev-month-${m.month}`} className="hud mb-2.5 flex items-baseline gap-2 px-2 text-teal">
            {m.label}
            <span className="tnum text-ink-2">{m.events.length}</span>
          </h2>
          <ul className="glass divide-y divide-divider overflow-hidden rounded-[24px]">
            {m.events.map((e) => (
              <li key={e.id}>
                <EventRow e={e} view={view} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function DateBlock({ e }: { e: EventItem }) {
  if (!e.startDate) return null
  const multi = e.endDate && e.endDate !== e.startDate
  return (
    <div className="flex w-16 shrink-0 flex-col items-center self-start rounded-[16px] bg-ink-chip py-2.5 text-center text-on-ink-chip" aria-hidden>
      <span className="hud text-on-ink-chip-2">{formatLocalDate(e.startDate, 'LLL')}</span>
      <span className="tnum text-[30px] leading-none font-light tracking-[-0.03em]">{formatLocalDate(e.startDate, 'd')}</span>
      <span className="text-[12px] text-on-ink-chip-2">{formatLocalDate(e.startDate, 'ccc')}</span>
      {multi ? (
        <span className="tnum mt-0.5 text-[12px] text-on-ink-chip-2">
          – {formatLocalDate(e.endDate!, e.endDate!.slice(0, 7) === e.startDate.slice(0, 7) ? 'd' : 'd LLL')}
        </span>
      ) : null}
    </div>
  )
}

function EventRow({ e, view }: { e: EventItem; view: EventsView }) {
  const cancelled = e.status === 'cancelled'
  const past = !!e.startDate && (e.endDate ?? e.startDate) < view.today
  return (
    <article aria-labelledby={`ev-${e.id}`} className="flex gap-4 p-4 transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--surface)_45%,transparent)] md:p-5">
      <DateBlock e={e} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3
            id={`ev-${e.id}`}
            className={cn('text-[16px] leading-snug font-semibold text-ink', cancelled && 'text-ink-2 line-through decoration-critical/70')}
          >
            {e.title}
          </h3>
          <span className="flex shrink-0 items-center gap-1.5">
            {past ? <span className="inline-flex h-6 items-center rounded-full bg-surface-3 px-2 text-[12px] font-medium text-ink-2">Past</span> : null}
            <EventStatus status={e.status} label={e.statusLabel} />
          </span>
        </div>
        <p className="tnum text-[14px] text-ink">
          {e.whenLabel}
          {e.timeLabel ? <span className="text-ink-2"> · {e.timeLabel}</span> : <span className="text-ink-3"> · times not stated</span>}
        </p>
        <EventWhere e={e} />
        <EventFacts e={e} />
        {e.status === 'tentative' && !past ? <p className="text-[12.5px] text-caution">Tentative — the organiser has not fixed these dates yet.</p> : null}
        {e.status === 'postponed' ? <p className="text-[12.5px] text-caution">Postponed — check the organiser for the new date.</p> : null}
        <EventMeta e={e} view={view} />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <AddEventToTrip event={e} trips={view.trips} today={view.today} />
          {e.icsUrl && !cancelled && !past ? (
            <a
              href={e.icsUrl}
              download
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--glass-edge)] bg-glass-strong px-3.5 text-[13.5px] font-medium text-ink transition-[color,border-color,transform] duration-150 hover:border-teal hover:text-teal active:scale-95 md:h-9"
            >
              <Download aria-hidden className="size-4" />
              Add to calendar
              <span className="sr-only"> (.ics file{e.status === 'tentative' ? ', marked tentative' : ''})</span>
            </a>
          ) : null}
          <EventLinks e={e} />
        </div>
      </div>
    </article>
  )
}

function EventWhere({ e }: { e: EventItem }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-ink-2">
      <MapPin aria-hidden className="size-3.5 shrink-0 text-ink-3" />
      {e.resort ? (
        <Link href={`/resorts/${e.resort.id}`} className="font-medium text-ink hover:text-teal hover:underline">
          {e.resort.name}
        </Link>
      ) : null}
      {e.venue && (!e.resort || e.distance !== 'on-site') ? <span>{e.resort ? `· ${e.venue}` : e.venue}</span> : null}
      <span className="text-ink-3">· {e.distance === 'on-site' ? 'at the resort' : 'distance from the resort not recorded'}</span>
    </p>
  )
}

function EventFacts({ e }: { e: EventItem }) {
  const facts: ReactNode[] = [
    <span key="cat">{e.categoryLabel}</span>,
    e.price ? (
      <span key="price" className="tnum font-medium text-ink">
        {e.price}
      </span>
    ) : (
      <span key="price" className="text-ink-3 italic">
        Price not published
      </span>
    ),
  ]
  if (e.ageRestriction) facts.push(<span key="age">{e.ageRestriction}</span>)
  if (e.bookingRequired === true) facts.push(<span key="book">Booking required</span>)
  if (e.bookingRequired === false) facts.push(<span key="book">No booking needed</span>)
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-2">
      {facts.map((x, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 ? (
            <span aria-hidden className="text-ink-3">
              ·
            </span>
          ) : null}
          {x}
        </span>
      ))}
    </p>
  )
}

function EventMeta({ e, view }: { e: EventItem; view: EventsView }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
      {e.lastVerifiedAt ? (
        <time dateTime={e.lastVerifiedAt} title={e.lastVerifiedAt}>
          Checked {relativeLabel(e.lastVerifiedAt, view.now)}
        </time>
      ) : null}
      <SourceDrawer
        title={`${e.title} — source`}
        label="Source"
        compact={false}
        items={[
          { label: 'Event listing', value: `${e.whenLabel} · ${e.statusLabel}`, prov: e.prov },
          ...(e.lastEdition ? [{ label: 'Last edition (for reference only)', value: e.lastEdition, prov: e.prov }] : []),
        ]}
      />
    </p>
  )
}

function EventLinks({ e }: { e: EventItem }) {
  return (
    <>
      {e.officialUrl ? (
        <a
          href={e.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-teal hover:underline md:h-9"
        >
          Official page <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
      {e.ticketUrl && e.ticketUrl !== e.officialUrl ? (
        <a
          href={e.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-[13.5px] font-medium text-teal hover:underline md:h-9"
        >
          Tickets <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </>
  )
}

function NoDated({ view, f, outside, onWiden }: { view: EventsView; f: EventFilters; outside: number; onWiden: () => void }) {
  return (
    <EmptyState
      seed="events-none"
      title={f.when === 'season' ? `No dated events for ${view.seasonLabel} yet` : 'No dated events in this window'}
      body={
        <>
          Most {view.seasonLabel} events are not announced yet. Piste lists a date only once the organiser publishes it — a previous edition&apos;s date is
          never rolled forward.
          {outside ? ` ${outside} dated ${outside === 1 ? 'event falls' : 'events fall'} outside this window.` : ''}
        </>
      }
      action={
        f.when !== 'season' ? (
          <button
            type="button"
            onClick={onWiden}
            className="inline-flex h-11 items-center rounded-full bg-ink-chip px-4 text-[14px] font-medium text-on-ink-chip md:h-10"
          >
            Show the whole season
          </button>
        ) : undefined
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Calendar

function EventCalendar({
  view,
  f,
  dated,
  win,
  onMonth,
}: {
  view: EventsView
  f: EventFilters
  dated: EventItem[]
  win: { from: string; to: string; label: string }
  onMonth: (m: string) => void
}) {
  const month = initialMonth(f, dated, win)
  const minMonth = view.seasonBounds.min.slice(0, 7)
  const maxMonth = view.seasonBounds.max.slice(0, 7)
  const weeks = monthGrid(month)
  const inMonth = dated.filter((e) => e.startDate! <= `${month}-31` && (e.endDate ?? e.startDate!) >= `${month}-01`)
  const firstWithEvents = weeks.flat().find((d) => d.inMonth && eventsOn(dated, d.date).length)?.date ?? null
  const [picked, setPicked] = useState<string | null>(null)
  // Paging direction for the month slide (previous month slides in from the left).
  const [shown, setShown] = useState({ month, dir: 1 })
  if (shown.month !== month) setShown({ month, dir: month > shown.month ? 1 : -1 })
  const day = picked && picked.slice(0, 7) === month ? picked : firstWithEvents
  const dayEvents = day ? eventsOn(dated, day) : []
  const label = formatLocalDate(`${month}-01`, 'LLLL yyyy')
  const go = (d: -1 | 1) => {
    const next = shiftMonth(month, d)
    if (next >= minMonth && next <= maxMonth) onMonth(next)
  }

  return (
    <section aria-labelledby="ev-cal-title" className="flex flex-col gap-4">
      <div className="glass rounded-[28px] p-3 md:p-5">
        <div className="flex items-center justify-between gap-3 px-1 pb-3 md:px-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
            <h2 id="ev-cal-title" className="sr-only">
              {label}
            </h2>
            <MonthTitle month={month} className="md:text-[24px]" />
            <span className="hud tnum text-ink-2">
              {inMonth.length} {inMonth.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <NavButton dir={-1} disabled={month <= minMonth} onClick={() => go(-1)} density="large" />
            <NavButton dir={1} disabled={month >= maxMonth} onClick={() => go(1)} density="large" />
          </div>
        </div>
        <SlidingMonths pageKey={month} dir={shown.dir} scope="ev-cal" onSwipe={go}>
          <table className="w-full table-fixed border-separate border-spacing-1">
            <caption className="sr-only">
              Dated events in {label} ({win.label}). The list below the calendar shows the selected day.
            </caption>
            <thead>
              <tr>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                  <th key={d} scope="col" className={cn('hud pb-1 text-center font-normal', i >= 5 ? 'text-teal' : 'text-ink-3')}>
                    <abbr title={d} className="no-underline">
                      {d.slice(0, 2)}
                    </abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w[0].date}>
                  {w.map((d) => {
                    const evs = d.inMonth ? eventsOn(dated, d.date) : []
                    const isToday = d.date === view.today
                    const on = d.date === day
                    return (
                      <td key={d.date} className="h-14 p-0 align-top md:h-[104px]">
                        {evs.length ? (
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => setPicked(d.date)}
                            aria-label={`${formatLocalDate(d.date, 'cccc d LLLL')}: ${evs.length} ${evs.length === 1 ? 'event' : 'events'}`}
                            className={cn(
                              'group/day relative flex h-full w-full flex-col items-stretch gap-1 rounded-[14px] p-1.5 text-left',
                              'bg-[color-mix(in_srgb,var(--surface)_62%,transparent)] transition-[background-color,translate,box-shadow] duration-150 ease-out',
                              'hover:-translate-y-px hover:bg-surface hover:shadow-[0_8px_20px_-10px_rgb(19_32_44/0.35)] active:scale-[0.98]',
                            )}
                          >
                            {on ? (
                              <motion.span
                                layoutId="ev-cal-knob"
                                transition={t.spring}
                                aria-hidden
                                className="absolute inset-0 rounded-[14px] bg-glacier/70 shadow-[inset_0_0_0_2px_var(--teal)]"
                              />
                            ) : null}
                            <DayNumber date={d.date} today={isToday} />
                            <span className="relative hidden min-w-0 flex-col gap-0.5 md:flex">
                              {evs.slice(0, 2).map((e) => (
                                <span key={e.id} className={cn('block truncate rounded-full px-2 py-[3px] text-[12px] leading-tight font-medium', STATUS_STYLE[e.status].cls)}>
                                  {e.title}
                                </span>
                              ))}
                              {evs.length > 2 ? <span className="px-1 text-[12px] text-ink-2">+{evs.length - 2} more</span> : null}
                            </span>
                            <span aria-hidden className="relative flex gap-0.5 px-1 md:hidden">
                              {evs.slice(0, 3).map((e) => (
                                <span
                                  key={e.id}
                                  className={cn('size-1.5 rounded-full', e.status === 'announced' ? 'bg-positive' : e.status === 'cancelled' ? 'bg-critical' : 'bg-caution')}
                                />
                              ))}
                            </span>
                          </button>
                        ) : (
                          <div className={cn('h-full rounded-[14px] p-1.5', d.inMonth ? 'bg-[color-mix(in_srgb,var(--surface)_28%,transparent)]' : 'opacity-50')}>
                            <DayNumber date={d.date} today={isToday} muted={!d.inMonth} />
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </SlidingMonths>
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] text-ink-2" aria-label="Calendar key">
          <li className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-2 rounded-full bg-positive" /> Announced
          </li>
          <li className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-2 rounded-full bg-caution" /> Tentative or postponed
          </li>
          <li className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-2 rounded-full bg-critical" /> Cancelled
          </li>
          <li className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--teal)]" /> Today
          </li>
        </ul>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {day && dayEvents.length ? (
          <motion.section
            key={day}
            aria-labelledby="ev-day-title"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={t.pageIn}
          >
            <h2 id="ev-day-title" className="hud mb-2.5 px-2 text-teal">
              {formatLocalDate(day, 'cccc d LLLL yyyy')}
            </h2>
            <ul className="glass divide-y divide-divider overflow-hidden rounded-[24px]">
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <EventRow e={e} view={view} />
                </li>
              ))}
            </ul>
          </motion.section>
        ) : (
          <p key="none" className="rounded-[18px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">
            No dated events in {label}
            {dated.length ? ' — use the arrows to find the months that have some.' : '.'} Events without an announced date are listed under “Watching for dates”,
            never placed on the calendar.
          </p>
        )}
      </AnimatePresence>
    </section>
  )
}

function DayNumber({ date, today, muted }: { date: string; today: boolean; muted?: boolean }) {
  return (
    <span
      className={cn(
        'tnum relative inline-flex size-7 items-center justify-center rounded-full text-[13px] font-medium',
        today ? 'font-semibold text-teal shadow-[inset_0_0_0_1.5px_var(--teal)]' : muted ? 'text-ink-3' : 'text-ink',
      )}
    >
      {Number(date.slice(8, 10))}
      {today ? <span className="sr-only"> (today)</span> : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Watching for dates

function Watching({ events, view }: { events: EventItem[]; view: EventsView }) {
  if (!events.length) return null
  return (
    <section aria-labelledby="ev-watching" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 id="ev-watching" className="hud flex items-baseline gap-2 text-teal">
          <Eye aria-hidden className="size-4 self-center text-ink-3" />
          Watching for dates
          <span className="tnum text-[13px] font-medium text-ink-3">{events.length}</span>
        </h2>
        <p className="max-w-[72ch] text-[13.5px] text-ink-2">
          These happen most seasons, but the {view.seasonLabel} edition has no announced date yet. They appear on the calendar only once the organiser publishes
          one — last season&apos;s date is shown for reference, never carried forward.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {events.map((e, i) => (
          <li key={e.id} className="piste-rise" style={i < 6 ? ({ '--rise-delay': `${i * 45}ms` } as CSSProperties) : undefined}>
            <article
              aria-labelledby={`ev-${e.id}`}
              className="flex h-full flex-col gap-1.5 rounded-[24px] border border-dashed border-divider-strong bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] p-5 transition-[translate,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-teal/40 hover:shadow-[0_14px_30px_-18px_rgb(19_32_44/0.45)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h3 id={`ev-${e.id}`} className="text-[16px] leading-snug font-semibold text-ink">
                  {e.title}
                </h3>
                <EventStatus status={e.status} label={e.status === 'not-announced' ? 'Dates not announced yet' : e.statusLabel} />
              </div>
              <EventWhere e={e} />
              <EventFacts e={e} />
              {e.lastEdition ? (
                <p className="text-[13px] text-ink-2">
                  <span className="text-ink-3">Last edition:</span> {e.lastEdition}
                </p>
              ) : (
                <p className="text-[13px] text-ink-3 italic">No previous edition recorded</p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                <EventMeta e={e} view={view} />
                <EventLinks e={e} />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
