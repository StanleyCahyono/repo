/**
 * Pure helpers for the Forecast components (no React, no DB). Unit-tested in model.test.ts.
 * Types come from the server read models as type-only imports (erased at build time).
 */
import type { DayView, HourView, ResortForecast } from '@/lib/data/forecast'
import type { DayPotential, ResortInfo } from '@/lib/data/forecast-screen'
import type { ReportView } from '@/lib/data/views'
import { addDays, daysBetween, formatInstant, formatLocalDate, zoneAbbrev } from '@/lib/domain/time'
import type { ScoreKind, SnowWindow } from '@/lib/domain/types'
import { hourInterval, sumKnown, type IntervalSemantics, type KnownSum } from '@/components/charts/scale'

export type PointKey = 'base' | 'summit'

export const POINT_LABEL: Record<PointKey, string> = { base: 'Base', summit: 'Upper mountain' }

export const ms = (iso: string) => Date.parse(iso)

/** 'Sat 16' */
export const dayShort = (date: string) => formatLocalDate(date, 'ccc d')
/** 'Sat 16 Jan' */
export const dayMedium = (date: string) => formatLocalDate(date, 'ccc d LLL')
/** 'Sat 16 Jan 2027' */
export const dayYear = (date: string) => formatLocalDate(date, 'ccc d LLL yyyy')
/** 'Saturday 16 January 2027' */
export const dayLong = (date: string) => formatLocalDate(date, 'cccc d LLLL yyyy')
/** 'January 2027' for 'YYYY-MM'. */
export const monthLong = (month: string) => formatLocalDate(`${month}-01`, 'LLLL yyyy')
/** 'Sat 16 Jan, 14:00 MST' in the resort's zone. */
export const instantLocal = (iso: string, tz: string, fmt = 'ccc d LLL, HH:mm') => `${formatInstant(iso, tz, fmt)} ${zoneAbbrev(iso, tz)}`
/** 'MST' (or 'MST/MDT' when a range crosses a DST change). */
export function zoneLabel(tz: string, instants: readonly string[]): string {
  const names = [...new Set(instants.map((i) => zoneAbbrev(i, tz)))]
  return names.join('/')
}

/** Where a selected date sits relative to a resort's local today and its last forecast day. */
export type DateZone = 'past' | 'today' | 'forecast' | 'beyond' | 'no-forecast'

export function dateZone(date: string, today: string, lastForecastDate: string | null): DateZone {
  if (date < today) return 'past'
  if (date === today) return 'today'
  if (!lastForecastDate) return 'no-forecast'
  return date <= lastForecastDate ? 'forecast' : 'beyond'
}

/** Last resort-local day the stored run covers (any hours), or null without a run. */
export function lastForecastDate(f: Pick<ResortForecast, 'daily'> | null | undefined): string | null {
  return f?.daily.length ? f.daily[f.daily.length - 1].date : null
}

/** Days the provider could at most reach from `today` (16-day models: today + 15). */
export const PROVIDER_MAX_DAYS = 16

/**
 * Hours that belong to "the next N hours" from the first stamp, honouring interval semantics: with preceding-hour
 * sums the first stamp's value is the hour that just ended, so the window is (T0, T0 + N h].
 */
export function windowHours(hourly: readonly HourView[], hours: number, semantics: IntervalSemantics): HourView[] {
  if (!hourly.length) return []
  const t0 = ms(hourly[0].validTime)
  const end = t0 + hours * 3_600_000
  return hourly.filter((h) => {
    const t = ms(h.validTime)
    return semantics === 'preceding-hour' ? t > t0 && t <= end : t >= t0 && t < end
  })
}

export interface HourlySummary {
  snow: KnownSum
  rain: KnownSum
  tempMin: number | null
  tempMax: number | null
  apparentMin: number | null
  windMax: number | null
  gustMax: number | null
  visibilityMin: number | null
  freezingMin: number | null
  freezingMax: number | null
  hours: number
}

const nums = (xs: readonly (number | null)[]) => xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
const minOf = (xs: readonly (number | null)[]) => (nums(xs).length ? Math.min(...nums(xs)) : null)
const maxOf = (xs: readonly (number | null)[]) => (nums(xs).length ? Math.max(...nums(xs)) : null)

/** Totals and extremes over the next `hours` hours (canonical metric units). */
export function summarizeHours(hourly: readonly HourView[], hours: number, semantics: IntervalSemantics): HourlySummary {
  const win = windowHours(hourly, hours, semantics)
  // Instantaneous values: every stamp inside the window, including the first.
  const t0 = hourly.length ? ms(hourly[0].validTime) : 0
  const inst = hourly.filter((h) => ms(h.validTime) <= t0 + hours * 3_600_000)
  return {
    snow: sumKnown(win.map((h) => h.snowfallCm)),
    rain: sumKnown(win.map((h) => h.rainMm)),
    tempMin: minOf(inst.map((h) => h.temperatureC)),
    tempMax: maxOf(inst.map((h) => h.temperatureC)),
    apparentMin: minOf(inst.map((h) => h.apparentTemperatureC)),
    windMax: maxOf(inst.map((h) => h.windKmh)),
    gustMax: maxOf(inst.map((h) => h.gustKmh)),
    visibilityMin: minOf(inst.map((h) => h.visibilityM)),
    freezingMin: minOf(inst.map((h) => h.freezingLevelM)),
    freezingMax: maxOf(inst.map((h) => h.freezingLevelM)),
    hours: win.length,
  }
}

/** Accumulation interval of an hourly stamp as readable text: "13:00–14:00". */
export function intervalLabel(h: Pick<HourView, 'validTime'>, semantics: IntervalSemantics, tz: string): string {
  const [a, b] = hourInterval(ms(h.validTime), semantics)
  const f = (t: number) => formatInstant(new Date(t).toISOString(), tz, 'HH:mm')
  return `${f(a)}–${f(b)}`
}

/** A variable is "not provided" when the source returned no value for it anywhere in the window. */
export function provided(hourly: readonly HourView[], key: keyof HourView): boolean {
  return hourly.some((h) => typeof h[key] === 'number' && Number.isFinite(h[key] as number))
}

/** Days from the daily outlook: the near days (0–6) and the less certain trend days after them. */
export function splitOutlook(daily: readonly DayView[]): { near: DayView[]; trend: DayView[] } {
  return { near: daily.filter((d) => !d.trend), trend: daily.filter((d) => d.trend) }
}

/**
 * Columns of the comparison matrix: the resort-local dates any selected resort's run covers, from the earliest
 * resort-local today. Trend = at or after day 8 for the reference resort (or flagged trend by any resort).
 */
export function outlookColumns(
  forecasts: readonly Pick<ResortForecast, 'daily' | 'today'>[],
  refToday: string,
): { date: string; trend: boolean; dayIndex: number }[] {
  const dates = new Map<string, boolean>()
  for (const f of forecasts) for (const d of f.daily) dates.set(d.date, (dates.get(d.date) ?? false) || d.trend)
  return [...dates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, trend]) => ({ date, dayIndex: daysBetween(refToday, date), trend: trend || daysBetween(refToday, date) >= 7 }))
}

/**
 * The potential to display for a day. Future days only ever show weather potential: a stored full conditions or
 * limited score for a future date is not shown as one ("never a full conditions score for the future").
 */
export function displayPotential(
  p: DayPotential | undefined,
  isFuture: boolean,
): { scoreKind: ScoreKind; score: number | null; descriptor: string | null } | null {
  if (!p) return null
  if (p.scoreKind === 'closed') return { scoreKind: 'closed', score: null, descriptor: 'Closed' }
  if (isFuture && p.scoreKind !== 'weather-potential')
    return { scoreKind: 'none', score: null, descriptor: p.eligibility === 'preseason' ? 'Not yet open' : null }
  return { scoreKind: p.scoreKind, score: p.score, descriptor: p.descriptor }
}

export const WINDOW_LABEL: Record<SnowWindow, string> = {
  overnight: 'Overnight',
  '24h': 'Last 24 h',
  '48h': 'Last 48 h',
  '72h': 'Last 72 h',
  '7d': 'Last 7 days',
  storm: 'Storm total',
  season: 'Season total',
}

/**
 * The single snowfall figure a calendar day shows from its report: the 24-hour window when stated, else overnight,
 * else 48 h. Null when the report states no such amount (unknown — never 0).
 */
export function headlineSnow(
  report: Pick<ReportView, 'snowfall'> | null | undefined,
): { window: SnowWindow; amountCm: number; sourceText: string | null } | null {
  if (!report) return null
  for (const w of ['24h', 'overnight', '48h'] as const) {
    const hit = report.snowfall.find((x) => x.window === w && typeof x.amountCm === 'number')
    if (hit) return { window: w, amountCm: hit.amountCm as number, sourceText: hit.sourceText ?? null }
  }
  return null
}

/** Tone for an official alert's severity (CAP: Extreme / Severe / Moderate / Minor / Unknown). */
export function severityTone(severity: string | null | undefined): 'critical' | 'caution' | 'info' {
  const s = (severity ?? '').toLowerCase()
  if (s === 'extreme' || s === 'severe') return 'critical'
  if (s === 'moderate') return 'caution'
  return 'info'
}

/** Configured elevation of a weather point (metres), from the catalog. */
export function pointElevation(info: Pick<ResortInfo, 'points'> | null | undefined, point: PointKey): number | null {
  return info?.points.find((p) => p.key === point)?.elevationM ?? null
}

/** Month arithmetic on 'YYYY-MM'. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** The date `n` days after `date`. */
export const plusDays = addDays
