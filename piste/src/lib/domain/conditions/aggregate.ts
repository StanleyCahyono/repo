/**
 * Hourly weather → resort-local daily aggregates and rolling windows.
 *
 * Interval semantics decide which hour a record describes:
 * - 'preceding-hour' (Open-Meteo): the value stamped T covers (T−1h, T]. A record stamped 00:00 local therefore
 *   belongs to the PREVIOUS local day.
 * - 'following-hour': the value stamped T covers [T, T+1h).
 * - 'instant': a point value at T; it represents [T, T+1h) for bucketing.
 * Each record is turned into one hour slot [start, end) and every aggregate selects whole slots, so an hour is
 * counted exactly once however windows or days are cut. Instantaneous variables (temperature, wind) in a
 * preceding-hour series are attributed to the same slot as the accumulations — an approximation within 1 h.
 *
 * Quantities are kept apart: snowfall (cm of new snow), rain (mm liquid), precipitation (mm water equivalent)
 * and modeled ground snow depth. Snowfall is never derived from rain or precipitation, and modeled depth is
 * never added to a reported piste base.
 */
import { DateTime } from 'luxon'
import type { HourlyWeather } from '@/lib/providers/types'
import { endOfLocalDay, hoursInLocalDay, localDateOf, localTimeToInstant, startOfLocalDay } from '../time'
import type { IntervalSemantics } from './types'

export const HOUR_MS = 3_600_000

/** One hour of weather: the record and the interval [startMs, endMs) it describes. */
export interface HourSlot {
  startMs: number
  endMs: number
  point: HourlyWeather
}

export interface PreparedSeries {
  semantics: IntervalSemantics
  /** Sorted by start, one slot per hour. */
  slots: readonly HourSlot[]
  /** Records sharing an hour with a later record in the input (later input wins). */
  duplicatesDropped: number
  /**
   * Records whose hour partly overlaps an earlier kept slot (irregular stamps such as 14:53 then 15:10). Dropped
   * so no stretch of time is counted twice; the gap they leave shows up as reduced coverage.
   */
  overlapsDropped: number
  /** Records whose validTime could not be parsed (ignored). */
  invalidTimes: number
}

export type HourlyNumericVariable = {
  [K in keyof HourlyWeather]: HourlyWeather[K] extends number | null ? K : never
}[keyof HourlyWeather]

export type AccumulationVariable = 'snowfallCm' | 'rainMm' | 'precipitationMm'

const NUMERIC_VARIABLES: readonly HourlyNumericVariable[] = [
  'temperatureC',
  'apparentTemperatureC',
  'snowfallCm',
  'rainMm',
  'precipitationMm',
  'windKmh',
  'gustKmh',
  'humidityPct',
  'visibilityM',
  'cloudCoverPct',
  'freezingLevelM',
  'snowDepthM',
  'weatherCode',
]

/** Parse a UTC ISO instant (strings without an offset are read as UTC). NaN when invalid. */
export function toMs(instant: string): number {
  const dt = DateTime.fromISO(instant, { zone: 'utc' })
  return dt.isValid ? dt.toMillis() : Number.NaN
}

export function msToIso(ms: number): string {
  return DateTime.fromMillis(ms, { zone: 'utc' }).toISO()!
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Normalise, de-duplicate (later input wins) and sort hourly records into hour slots. */
export function prepareSeries(points: readonly HourlyWeather[], semantics: IntervalSemantics): PreparedSeries {
  const bySlot = new Map<number, HourSlot>()
  let duplicatesDropped = 0
  let invalidTimes = 0
  for (const point of points) {
    const t = toMs(point.validTime)
    if (Number.isNaN(t)) {
      invalidTimes++
      continue
    }
    const startMs = semantics === 'preceding-hour' ? t - HOUR_MS : t
    if (bySlot.has(startMs)) duplicatesDropped++
    bySlot.set(startMs, { startMs, endMs: startMs + HOUR_MS, point })
  }
  const slots: HourSlot[] = []
  let overlapsDropped = 0
  for (const slot of [...bySlot.values()].sort((a, b) => a.startMs - b.startMs)) {
    const prev = slots[slots.length - 1]
    if (prev && slot.startMs < prev.endMs) {
      overlapsDropped++
      continue
    }
    slots.push(slot)
  }
  return { semantics, slots, duplicatesDropped, overlapsDropped, invalidTimes }
}

/** Slots whose whole hour lies inside [fromMs, toMs]. */
export function slotsWithin(series: PreparedSeries, fromMs: number, toMs: number): HourSlot[] {
  return series.slots.filter((s) => s.startMs >= fromMs && s.endMs <= toMs)
}

/** Resort-local wall-clock window on a date as UTC milliseconds. */
export function localWindowMs(date: string, opens: string, closes: string, tz: string): { fromMs: number; toMs: number } {
  return { fromMs: toMs(localTimeToInstant(date, opens, tz)), toMs: toMs(localTimeToInstant(date, closes, tz)) }
}

export function values(slots: readonly HourSlot[], variable: HourlyNumericVariable): number[] {
  const out: number[] = []
  for (const s of slots) {
    const v = s.point[variable]
    if (isNum(v)) out.push(v)
  }
  return out
}

const sumOf = (xs: number[]) => (xs.length ? round3(xs.reduce((a, b) => a + b, 0)) : null)
const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : null)
const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null)
const meanOf = (xs: number[]) => (xs.length ? round3(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

// ---------------------------------------------------------------------------
// Rolling windows

export interface WindowSum {
  variable: AccumulationVariable
  /** Window (from, to] expressed as UTC instants. */
  from: string
  to: string
  expectedHours: number
  /** Hours present in the series (any values). */
  hoursCovered: number
  /** Hours with a non-null value for this variable. */
  hoursWithValue: number
  /** hoursWithValue ÷ expectedHours. */
  coverage: number
  complete: boolean
  /** Sum over hours with values; null when no hour had a value (unknown, not zero). */
  sum: number | null
}

/** Sum an accumulation over the whole hours inside [from, to]. */
export function sumBetween(series: PreparedSeries, variable: AccumulationVariable, from: string, to: string): WindowSum {
  const fromMs = toMs(from)
  const endMs = toMs(to)
  const expectedHours = Math.max(0, Math.floor((endMs - fromMs) / HOUR_MS))
  const slots = slotsWithin(series, fromMs, endMs)
  const vals = values(slots, variable)
  const coverage = expectedHours === 0 ? 0 : Math.min(1, vals.length / expectedHours)
  return {
    variable,
    from: msToIso(fromMs),
    to: msToIso(endMs),
    expectedHours,
    hoursCovered: slots.length,
    hoursWithValue: vals.length,
    coverage,
    complete: expectedHours > 0 && vals.length >= expectedHours,
    sum: sumOf(vals),
  }
}

/** Sum over the N hours ending at `endAt`. */
export function rollingSum(series: PreparedSeries, variable: AccumulationVariable, endAt: string, hours: number): WindowSum {
  return sumBetween(series, variable, msToIso(toMs(endAt) - hours * HOUR_MS), endAt)
}

/** Several rolling windows ending at the same instant, e.g. 24/48/72 h snowfall. */
export function rollingWindows(
  series: PreparedSeries,
  variable: AccumulationVariable,
  endAt: string,
  hoursList: readonly number[] = [24, 48, 72],
): Record<number, WindowSum> {
  const out: Record<number, WindowSum> = {}
  for (const h of hoursList) out[h] = rollingSum(series, variable, endAt, h)
  return out
}

// ---------------------------------------------------------------------------
// Resort-local daily aggregates

export interface DailyWeatherAggregate {
  date: string
  timezone: string
  semantics: IntervalSemantics
  /** Real hours in the local day: 24, or 23/25 on DST transition days. */
  expectedHours: number
  hoursCovered: number
  /** hoursCovered ÷ expectedHours. A partial day is never presented as complete. */
  coverage: number
  complete: boolean
  /** validTime of the first/last record attributed to this day. */
  firstHour: string | null
  lastHour: string | null
  snowfallCm: number | null
  rainMm: number | null
  precipitationMm: number | null
  tempMinC: number | null
  tempMaxC: number | null
  tempMeanC: number | null
  apparentMinC: number | null
  apparentMaxC: number | null
  windMaxKmh: number | null
  gustMaxKmh: number | null
  visibilityMinM: number | null
  cloudMeanPct: number | null
  freezingLevelMinM: number | null
  freezingLevelMaxM: number | null
  /** Hours with temperature < 0 °C among hours with a temperature; null without temperatures. */
  hoursBelowFreezing: number | null
  /** Modeled ground snow depth at the day's last hour with a value (cm). Modeled; never a piste base depth. */
  modeledSnowDepthCm: number | null
  /** Per-variable share of expected hours that had a value. */
  variableCoverage: Partial<Record<HourlyNumericVariable, number>>
}

export function aggregateDay(series: PreparedSeries, date: string, tz: string): DailyWeatherAggregate {
  const fromMs = toMs(startOfLocalDay(date, tz))
  const endMs = toMs(endOfLocalDay(date, tz))
  const expectedHours = hoursInLocalDay(date, tz)
  const slots = series.slots.filter((s) => s.startMs >= fromMs && s.startMs < endMs)
  const temps = values(slots, 'temperatureC')
  const depths = values(slots, 'snowDepthM')
  const variableCoverage: Partial<Record<HourlyNumericVariable, number>> = {}
  for (const v of NUMERIC_VARIABLES) variableCoverage[v] = Math.min(1, values(slots, v).length / expectedHours)
  const hoursCovered = Math.min(slots.length, expectedHours)
  return {
    date,
    timezone: tz,
    semantics: series.semantics,
    expectedHours,
    hoursCovered,
    coverage: hoursCovered / expectedHours,
    complete: hoursCovered >= expectedHours,
    firstHour: slots.length ? msToIso(toMs(slots[0].point.validTime)) : null,
    lastHour: slots.length ? msToIso(toMs(slots[slots.length - 1].point.validTime)) : null,
    snowfallCm: sumOf(values(slots, 'snowfallCm')),
    rainMm: sumOf(values(slots, 'rainMm')),
    precipitationMm: sumOf(values(slots, 'precipitationMm')),
    tempMinC: minOf(temps),
    tempMaxC: maxOf(temps),
    tempMeanC: meanOf(temps),
    apparentMinC: minOf(values(slots, 'apparentTemperatureC')),
    apparentMaxC: maxOf(values(slots, 'apparentTemperatureC')),
    windMaxKmh: maxOf(values(slots, 'windKmh')),
    gustMaxKmh: maxOf(values(slots, 'gustKmh')),
    visibilityMinM: minOf(values(slots, 'visibilityM')),
    cloudMeanPct: meanOf(values(slots, 'cloudCoverPct')),
    freezingLevelMinM: minOf(values(slots, 'freezingLevelM')),
    freezingLevelMaxM: maxOf(values(slots, 'freezingLevelM')),
    hoursBelowFreezing: temps.length ? temps.filter((t) => t < 0).length : null,
    modeledSnowDepthCm: depths.length ? round3(depths[depths.length - 1] * 100) : null,
    variableCoverage,
  }
}

/** Aggregates for every resort-local day the series touches, in date order. */
export function aggregateDays(series: PreparedSeries, tz: string): DailyWeatherAggregate[] {
  const dates = new Set<string>()
  for (const s of series.slots) dates.add(localDateOf(msToIso(s.startMs), tz))
  return [...dates].sort().map((d) => aggregateDay(series, d, tz))
}
