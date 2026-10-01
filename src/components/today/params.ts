/**
 * Today's URL state — the query string is the single source of truth so a reload, a shared link or "back from a
 * resort" restores exactly what was on screen.
 *
 *   ?date=YYYY-MM-DD            one resort-local day (omitted = today)
 *   ?from=YYYY-MM-DD&to=…       a range (≤ 14 days; wins over `date`)
 *   ?preset=learning|best-snow|lowest-cost|short-drive|apres-weekend|custom
 *   ?fw=weekend|next-weekend|7d|14d   weekend-finder window (omitted = this weekend)
 *
 * Past dates are ignored (a recommendation is about days still ahead) and reported in `ignored`, never silently
 * turned into something else. Pure module: no clock — callers pass the home "today".
 */
import { RECOMMEND_PRESETS, type RecommendPreset } from '@/lib/domain/recommend'
import { addDays, daysBetween, formatLocalDate, isLocalDate, isoWeekday, nextSaturday } from '@/lib/domain/time'

/** Matches src/lib/data/today.ts MAX_RANGE_DAYS (kept here so this module stays client-safe). */
export const MAX_RANGE_DAYS = 14

export type SearchRecord = Record<string, string | string[] | undefined>

export const FINDER_WINDOWS = ['weekend', 'next-weekend', '7d', '14d'] as const
export type FinderWindow = (typeof FINDER_WINDOWS)[number]

export const FINDER_WINDOW_LABEL: Record<FinderWindow, string> = {
  weekend: 'This weekend',
  'next-weekend': 'Next weekend',
  '7d': 'Next 7 days',
  '14d': 'Next 14 days',
}

export type QuickRange = 'today' | 'tomorrow' | 'weekend' | 'custom'

export interface DateRange {
  from: string
  to: string
}

export interface TodayParams {
  /** A single requested day (null = today). */
  date: string | null
  /** A requested range (null = single day). */
  range: DateRange | null
  preset: RecommendPreset | null
  finder: FinderWindow
  /** Why a requested date or range was not used ("Sat 3 Oct has passed"), or null. */
  ignored: string | null
}

const one = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

function read(sp: SearchRecord | URLSearchParams, key: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(key)
  return one(sp[key])
}

export function isPreset(v: unknown): v is RecommendPreset {
  return typeof v === 'string' && (RECOMMEND_PRESETS as readonly string[]).includes(v)
}

export function isFinderWindow(v: unknown): v is FinderWindow {
  return typeof v === 'string' && (FINDER_WINDOWS as readonly string[]).includes(v)
}

/** This weekend: the coming Sat–Sun (Sat–Sun when today is Saturday, just Sunday when today is Sunday). */
export function weekendOf(today: string): DateRange {
  if (isoWeekday(today) === 7) return { from: today, to: today }
  const sat = nextSaturday(today)
  return { from: sat, to: addDays(sat, 1) }
}

/** The weekend after this one. */
export function nextWeekendOf(today: string): DateRange {
  const sat = isoWeekday(today) === 7 ? nextSaturday(today) : addDays(nextSaturday(today), 7)
  return { from: sat, to: addDays(sat, 1) }
}

export function finderRange(window: FinderWindow, today: string): DateRange {
  switch (window) {
    case 'weekend':
      return weekendOf(today)
    case 'next-weekend':
      return nextWeekendOf(today)
    case '7d':
      return { from: today, to: addDays(today, 6) }
    case '14d':
      return { from: today, to: addDays(today, MAX_RANGE_DAYS - 1) }
  }
}

/** Clamp a range to MAX_RANGE_DAYS (same rule as the data layer, so labels match what was ranked). */
export function clampRange(r: DateRange): DateRange {
  const last = addDays(r.from, MAX_RANGE_DAYS - 1)
  return { from: r.from, to: r.to > last ? last : r.to }
}

export function parseTodayParams(sp: SearchRecord | URLSearchParams, today: string): TodayParams {
  const presetRaw = read(sp, 'preset')
  const fwRaw = read(sp, 'fw')
  const preset = isPreset(presetRaw) ? presetRaw : null
  const finder = isFinderWindow(fwRaw) ? fwRaw : 'weekend'

  const from = read(sp, 'from')
  const to = read(sp, 'to')
  if (from || to) {
    if (!isLocalDate(from) || !isLocalDate(to) || to < from)
      return {
        date: null,
        range: null,
        preset,
        finder,
        ignored: 'That date range could not be read — showing today',
      }
    if (to < today)
      return {
        date: null,
        range: null,
        preset,
        finder,
        ignored: `${formatDates([from, to])} has passed — showing today`,
      }
    const start = from < today ? today : from
    const range = clampRange({ from: start, to })
    return range.from === range.to
      ? {
          date: range.from === today ? null : range.from,
          range: null,
          preset,
          finder,
          ignored: null,
        }
      : { date: null, range, preset, finder, ignored: null }
  }
  const date = read(sp, 'date')
  if (date) {
    if (!isLocalDate(date))
      return {
        date: null,
        range: null,
        preset,
        finder,
        ignored: 'That date could not be read — showing today',
      }
    if (date < today)
      return {
        date: null,
        range: null,
        preset,
        finder,
        ignored: `${formatLocalDate(date)} has passed — showing today`,
      }
    return {
      date: date === today ? null : date,
      range: null,
      preset,
      finder,
      ignored: null,
    }
  }
  return { date: null, range: null, preset, finder, ignored: null }
}

/** The dates a params object resolves to (inclusive, in order). */
export function datesOf(p: Pick<TodayParams, 'date' | 'range'>, today: string): string[] {
  if (p.range) {
    const out: string[] = []
    for (let d = p.range.from; d <= p.range.to; d = addDays(d, 1)) out.push(d)
    return out
  }
  return [p.date ?? today]
}

/** Which quick chip a set of dates corresponds to. */
export function quickRangeOf(dates: readonly string[], today: string): QuickRange {
  if (dates.length === 1 && dates[0] === today) return 'today'
  if (dates.length === 1 && dates[0] === addDays(today, 1)) return 'tomorrow'
  const w = weekendOf(today)
  if (dates.length && dates[0] === w.from && dates[dates.length - 1] === w.to && dates.length === daysBetween(w.from, w.to) + 1) return 'weekend'
  return 'custom'
}

/** Query patch for a quick chip (null values delete the key). */
export function quickPatch(q: Exclude<QuickRange, 'custom'>, today: string): Record<string, string | null> {
  if (q === 'today') return { date: null, from: null, to: null }
  if (q === 'tomorrow') return { date: addDays(today, 1), from: null, to: null }
  const w = weekendOf(today)
  return w.from === w.to ? { date: w.from === today ? null : w.from, from: null, to: null } : { date: null, from: w.from, to: w.to }
}

/** Query patch for one day (the strip) or a custom range. */
export function datesPatch(from: string, to: string | null, today: string): Record<string, string | null> {
  if (!to || to === from) return { date: from === today ? null : from, from: null, to: null }
  return { date: null, from, to }
}

/** Apply a patch to a query string; returns "?a=b" or "" (stable key order for tidy URLs). */
export function patchQuery(search: string, patch: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(search.replace(/^\?/, ''))
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') q.delete(k)
    else q.set(k, v)
  }
  const order = ['date', 'from', 'to', 'preset', 'fw']
  const entries = [...q.entries()].sort(([a], [b]) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
  const s = new URLSearchParams(entries).toString()
  return s ? `?${s}` : ''
}

/** "Fri 15 Jan" · "Sat 16 – Sun 17 Jan" · "Sat 30 Jan – Sun 7 Feb". */
export function formatDates(dates: readonly string[]): string {
  if (!dates.length) return ''
  const a = dates[0]
  const b = dates[dates.length - 1]
  if (a === b) return formatLocalDate(a)
  if (a.slice(0, 7) === b.slice(0, 7)) return `${formatLocalDate(a, 'ccc d')} – ${formatLocalDate(b)}`
  return `${formatLocalDate(a)} – ${formatLocalDate(b)}`
}

/** "today" / "tomorrow" / "Sat 16 Jan" — for sentences. */
export function relativeDay(date: string, today: string): string {
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  return formatLocalDate(date)
}
