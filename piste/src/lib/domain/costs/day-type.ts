/**
 * Day types for price lookup: weekday / weekend / holiday. Holidays are configurable: US federal holidays
 * (computed per season, so the same config serves later seasons), an optional Christmas–New Year period, and
 * user-added dates/ranges. Holiday wins over weekend. Resorts publish their own "holiday"/"peak" calendars —
 * those belong on the price snapshot's appliesFrom/To, not here.
 */
import { DateTime } from 'luxon'
import { addDays, isLocalDate, isWeekend, seasonIdFor } from '../time'
import type { DateRange } from '../types'

export type DayType = 'weekday' | 'weekend' | 'holiday'

export interface DayTypeConfig {
  usFederalHolidays: boolean
  /** Also mark the weekday a Saturday/Sunday fixed-date holiday is observed on. */
  includeObserved: boolean
  /** Inclusive month-day period that may wrap the year end, e.g. { from: '12-25', to: '01-01' }. */
  christmasNewYear: { readonly from: string; readonly to: string } | null
  extraHolidays: readonly { date: string; name: string }[]
  extraRanges: readonly DateRange[]
}

/** Frozen: build a new object to customise (holiday lists are memoised for this exact config). */
export const DEFAULT_DAY_TYPE_CONFIG: Readonly<DayTypeConfig> = Object.freeze({
  usFederalHolidays: true,
  includeObserved: true,
  christmasNewYear: Object.freeze({ from: '12-25', to: '01-01' }),
  extraHolidays: Object.freeze([]),
  extraRanges: Object.freeze([]),
})

export interface Holiday {
  date: string
  name: string
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: 'UTC' })
  const offset = (weekday - first.weekday + 7) % 7
  return first.plus({ days: offset + (n - 1) * 7 }).toISODate()!
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = DateTime.fromObject({ year, month, day: 1 }, { zone: 'UTC' }).endOf('month').startOf('day')
  const offset = (last.weekday - weekday + 7) % 7
  return last.minus({ days: offset }).toISODate()!
}

function fixed(year: number, month: number, day: number, name: string, observed: boolean): Holiday[] {
  const date = DateTime.fromObject({ year, month, day }, { zone: 'UTC' })
  const out: Holiday[] = [{ date: date.toISODate()!, name }]
  if (observed && date.weekday === 6) out.push({ date: date.minus({ days: 1 }).toISODate()!, name: `${name} (observed)` })
  if (observed && date.weekday === 7) out.push({ date: date.plus({ days: 1 }).toISODate()!, name: `${name} (observed)` })
  return out
}

/** US federal holidays in a calendar year (5 U.S.C. 6103). */
export function usFederalHolidays(year: number, includeObserved = true): Holiday[] {
  const o = includeObserved
  return [
    ...fixed(year, 1, 1, "New Year's Day", o),
    { date: nthWeekday(year, 1, 1, 3), name: 'Martin Luther King Jr. Day' },
    { date: nthWeekday(year, 2, 1, 3), name: "Washington's Birthday (Presidents' Day)" },
    { date: lastWeekday(year, 5, 1), name: 'Memorial Day' },
    ...fixed(year, 6, 19, 'Juneteenth', o),
    ...fixed(year, 7, 4, 'Independence Day', o),
    { date: nthWeekday(year, 9, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(year, 10, 1, 2), name: 'Columbus Day' },
    ...fixed(year, 11, 11, 'Veterans Day', o),
    { date: nthWeekday(year, 11, 4, 4), name: 'Thanksgiving Day' },
    ...fixed(year, 12, 25, 'Christmas Day', o),
  ]
}

function seasonBounds(seasonId: string): { from: string; to: string; startYear: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(seasonId)
  if (!m) throw new Error(`Invalid season id: ${seasonId}`)
  const startYear = Number(m[1])
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30`, startYear }
}

/**
 * Every holiday date in a season (1 Jul → 30 Jun), sorted. Period days are listed individually.
 */
export function holidaysForSeason(seasonId: string, config: DayTypeConfig = DEFAULT_DAY_TYPE_CONFIG): Holiday[] {
  const { from, to, startYear } = seasonBounds(seasonId)
  const byDate = new Map<string, string>()
  const put = (h: Holiday) => {
    if (h.date >= from && h.date <= to && !byDate.has(h.date)) byDate.set(h.date, h.name)
  }
  if (config.usFederalHolidays) {
    for (const y of [startYear, startYear + 1]) usFederalHolidays(y, config.includeObserved).forEach(put)
  }
  if (config.christmasNewYear) {
    const start = `${startYear}-${config.christmasNewYear.from}`
    const wraps = config.christmasNewYear.to < config.christmasNewYear.from
    const end = `${wraps ? startYear + 1 : startYear}-${config.christmasNewYear.to}`
    if (!isLocalDate(start) || !isLocalDate(end)) throw new Error('christmasNewYear period must use MM-DD dates')
    for (let d = start; d <= end; d = addDays(d, 1)) put({ date: d, name: 'Christmas–New Year period' })
  }
  config.extraHolidays.forEach(put)
  for (const r of config.extraRanges) {
    if (!isLocalDate(r.from) || !isLocalDate(r.to)) continue
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) put({ date: d, name: r.label ?? 'Holiday period' })
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, name]) => ({ date, name }))
}

/** 2026-27 holiday calendar with the default config — exported for docs and settings display. */
export const HOLIDAYS_2026_27: readonly Holiday[] = holidaysForSeason('2026-27')

const defaultCache = new Map<string, Holiday[]>()
function seasonHolidays(seasonId: string, config: DayTypeConfig): Holiday[] {
  if (config !== DEFAULT_DAY_TYPE_CONFIG) return holidaysForSeason(seasonId, config)
  let hit = defaultCache.get(seasonId)
  if (!hit) defaultCache.set(seasonId, (hit = holidaysForSeason(seasonId, config)))
  return hit
}

export function dayTypeFor(
  date: string,
  config: DayTypeConfig = DEFAULT_DAY_TYPE_CONFIG,
): { dayType: DayType; holidayName: string | null } {
  if (!isLocalDate(date)) throw new Error(`dayTypeFor: invalid local date ${String(date)}`)
  const hit = seasonHolidays(seasonIdFor(date), config).find((h) => h.date === date)
  if (hit) return { dayType: 'holiday', holidayName: hit.name }
  return { dayType: isWeekend(date) ? 'weekend' : 'weekday', holidayName: null }
}
