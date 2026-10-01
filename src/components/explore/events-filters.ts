/**
 * Events tab: URL state, date windows, filtering and calendar helpers. Pure (no React, no DB) — unit-tested.
 *
 * URL keys (all optional):
 *   view   list (default) | calendar
 *   when   upcoming (default: today → end of season) | 30d | season | trip | custom
 *   from, to  YYYY-MM-DD for `custom`         trip    trip id for `when=trip`
 *   resort resort id                           cat     comma list of categories
 *   price  any (default) | free | paid | unknown
 *   month  YYYY-MM shown by the calendar
 *
 * Honesty: an event without an announced date is never placed in a window or on the calendar — it is listed under
 * "Watching for dates" (filtered by resort, category and price only). Last season's dates are never rolled forward.
 */
import type { EventItem, TripOption } from '@/lib/data/explore'
import { addDays, formatLocalDate, isLocalDate, isoWeekday } from '@/lib/domain/time'

export type EventsLayout = 'list' | 'calendar'
export type WhenKey = 'upcoming' | '30d' | 'season' | 'trip' | 'custom'
export type PriceKey = 'any' | 'free' | 'paid' | 'unknown'

export interface EventFilters {
  view: EventsLayout
  when: WhenKey
  from: string | null
  to: string | null
  trip: string | null
  resort: string | null
  cats: string[]
  price: PriceKey
  month: string | null
}

export const DEFAULT_EVENT_FILTERS: EventFilters = {
  view: 'list',
  when: 'upcoming',
  from: null,
  to: null,
  trip: null,
  resort: null,
  cats: [],
  price: 'any',
  month: null,
}

export const WHEN_LABEL: Record<WhenKey, string> = {
  upcoming: 'Upcoming this season',
  '30d': 'Next 30 days',
  season: 'Whole season',
  trip: 'During a trip',
  custom: 'Custom dates',
}

/** Short labels for the "When" picker (the window label in sentences stays the longer WHEN_LABEL). */
export const WHEN_OPTION: Record<WhenKey, string> = {
  upcoming: 'Upcoming',
  '30d': 'Next 30 days',
  season: 'Whole season',
  trip: 'During a trip',
  custom: 'Custom dates',
}

export const PRICE_LABEL: Record<PriceKey, string> = { any: 'Any price', free: 'Free', paid: 'Paid', unknown: 'Price not published' }

const WHENS: WhenKey[] = ['upcoming', '30d', 'season', 'trip', 'custom']
const PRICES: PriceKey[] = ['any', 'free', 'paid', 'unknown']
const ID = /^[a-z0-9-]{1,120}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

type Src = URLSearchParams | { get(key: string): string | null }

export function parseEventFilters(src: Src): EventFilters {
  const get = (k: string) => src.get(k)
  const when = get('when')
  const price = get('price')
  const from = get('from')
  const to = get('to')
  const trip = get('trip')
  const resort = get('resort')
  const month = get('month')
  return {
    view: get('view') === 'calendar' ? 'calendar' : 'list',
    when: when && (WHENS as string[]).includes(when) ? (when as WhenKey) : 'upcoming',
    from: from && isLocalDate(from) ? from : null,
    to: to && isLocalDate(to) ? to : null,
    trip: trip && ID.test(trip) ? trip : null,
    resort: resort && ID.test(resort) ? resort : null,
    cats: [
      ...new Set(
        (get('cat') ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter((x) => /^[a-z0-9-]{1,40}$/.test(x)),
      ),
    ].slice(0, 12),
    price: price && (PRICES as string[]).includes(price) ? (price as PriceKey) : 'any',
    month: month && MONTH.test(month) ? month : null,
  }
}

const KEYS = ['view', 'when', 'from', 'to', 'trip', 'resort', 'cat', 'price', 'month'] as const

export function eventFiltersToParams(f: EventFilters, base?: URLSearchParams | string): URLSearchParams {
  const p = new URLSearchParams(base ?? '')
  for (const k of KEYS) p.delete(k)
  if (f.view !== 'list') p.set('view', f.view)
  if (f.when !== 'upcoming') p.set('when', f.when)
  if (f.when === 'custom' && f.from) p.set('from', f.from)
  if (f.when === 'custom' && f.to) p.set('to', f.to)
  if (f.when === 'trip' && f.trip) p.set('trip', f.trip)
  if (f.resort) p.set('resort', f.resort)
  if (f.cats.length) p.set('cat', f.cats.join(','))
  if (f.price !== 'any') p.set('price', f.price)
  if (f.view === 'calendar' && f.month) p.set('month', f.month)
  return p
}

export interface EventWindow {
  from: string
  to: string
  /** "Upcoming this season", "Next 30 days", "Presidents' Day trip (13–17 Feb)". */
  label: string
}

/** The date window for dated events. Invalid or missing inputs fall back to "upcoming this season". */
export function windowFor(f: EventFilters, ctx: { today: string; seasonBounds: { min: string; max: string }; trips: readonly TripOption[] }): EventWindow {
  const upcoming: EventWindow = { from: ctx.today, to: ctx.seasonBounds.max >= ctx.today ? ctx.seasonBounds.max : ctx.today, label: WHEN_LABEL.upcoming }
  switch (f.when) {
    case '30d':
      return { from: ctx.today, to: addDays(ctx.today, 30), label: WHEN_LABEL['30d'] }
    case 'season':
      return { from: ctx.seasonBounds.min, to: ctx.seasonBounds.max, label: WHEN_LABEL.season }
    case 'trip': {
      const t = ctx.trips.find((x) => x.id === f.trip)
      return t ? { from: t.startDate, to: t.endDate, label: `${t.name} (${t.label})` } : upcoming
    }
    case 'custom': {
      const a = f.from ?? ctx.today
      const b = f.to ?? upcoming.to
      const [from, to] = a <= b ? [a, b] : [b, a]
      return { from, to, label: `${formatLocalDate(from, 'd LLL yyyy')} – ${formatLocalDate(to, 'd LLL yyyy')}` }
    }
    default:
      return upcoming
  }
}

/** A dated event overlaps [from, to] (inclusive local dates). */
export function overlaps(e: Pick<EventItem, 'startDate' | 'endDate'>, from: string, to: string): boolean {
  if (!e.startDate) return false
  return e.startDate <= to && (e.endDate ?? e.startDate) >= from
}

function common(e: EventItem, f: EventFilters): boolean {
  if (f.resort && e.resort?.id !== f.resort) return false
  if (f.cats.length && !f.cats.includes(e.category)) return false
  if (f.price !== 'any' && e.priceKind !== f.price) return false
  return true
}

export interface EventSelection {
  /** Dated events overlapping the window, in date order. */
  dated: EventItem[]
  /** Events with no announced date (never placed in a window). */
  watching: EventItem[]
  /** Dated events matching resort/category/price but outside the window. */
  outside: EventItem[]
}

export function selectEvents(events: readonly EventItem[], f: EventFilters, win: Pick<EventWindow, 'from' | 'to'>): EventSelection {
  const dated: EventItem[] = []
  const watching: EventItem[] = []
  const outside: EventItem[] = []
  for (const e of events) {
    if (!common(e, f)) continue
    if (!e.dated) watching.push(e)
    else if (overlaps(e, win.from, win.to)) dated.push(e)
    else outside.push(e)
  }
  const byDate = (a: EventItem, b: EventItem) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.title.localeCompare(b.title)
  return { dated: dated.sort(byDate), watching: watching.sort((a, b) => a.title.localeCompare(b.title)), outside: outside.sort(byDate) }
}

/** Dated events grouped by the month they start in. */
export function groupByMonth(events: readonly EventItem[]): { month: string; label: string; events: EventItem[] }[] {
  const m = new Map<string, EventItem[]>()
  for (const e of events) {
    if (!e.startDate) continue
    const k = e.startDate.slice(0, 7)
    m.set(k, [...(m.get(k) ?? []), e])
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({ month, label: formatLocalDate(`${month}-01`, 'LLLL yyyy'), events: list }))
}

export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + delta
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

/** Monday-first weeks covering a month; days outside the month are included (inMonth false) to fill the grid. */
export function monthGrid(month: string): { date: string; inMonth: boolean }[][] {
  const first = `${month}-01`
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1)
  const start = addDays(first, -(isoWeekday(first) - 1))
  const end = addDays(last, 7 - isoWeekday(last))
  const weeks: { date: string; inMonth: boolean }[][] = []
  let week: { date: string; inMonth: boolean }[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    week.push({ date: d, inMonth: d.slice(0, 7) === month })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  return weeks
}

/** Events taking place on a local date (multi-day events on every day they span). */
export function eventsOn(events: readonly EventItem[], date: string): EventItem[] {
  return events.filter((e) => overlaps(e, date, date))
}

/** Month the calendar opens on: the URL's, else the first dated event's in the window, else the window start. */
export function initialMonth(f: EventFilters, dated: readonly EventItem[], win: Pick<EventWindow, 'from'>): string {
  if (f.month) return f.month
  return (dated[0]?.startDate ?? win.from).slice(0, 7)
}
