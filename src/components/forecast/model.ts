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

// ---------------------------------------------------------------------------
// Glass HUD charts (16-day strip, 48-hour glance, month calendar)

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The page headline's total: modeled snowfall summed over the stored days (display units). `atLeast` when a day is
 * partial or a day's amount is not provided (the sum is then a lower bound); null when no day states an amount.
 */
export function outlookTotal(
  daily: readonly Pick<DayView, 'snowfallCm' | 'partial'>[],
  toDisplay: (cm: number | null) => number | null,
): { total: number; atLeast: boolean; days: number } | null {
  const known = daily.filter((d) => finite(d.snowfallCm))
  if (!known.length) return null
  const total = known.reduce((a, d) => a + (toDisplay(d.snowfallCm) ?? 0), 0)
  return { total, atLeast: known.length < daily.length || daily.some((d) => d.partial), days: daily.length }
}

/** Geometry for daily high/low lines in a `w × h` viewBox, with `pad` px top/bottom. Unknown values break the line. */
export function tempGeometry(
  his: readonly (number | null)[],
  los: readonly (number | null)[],
  opts: { w: number; top: number; bottom: number; freezing: number },
): { hi: string; lo: string; band: string; zeroY: number | null; y: (v: number) => number; min: number; max: number } | null {
  const all = [...his, ...los].filter(finite)
  if (!all.length) return null
  const n = Math.max(his.length, los.length)
  const min = Math.min(...all, opts.freezing) - 2
  const max = Math.max(...all, opts.freezing) + 2
  const y = (v: number) => opts.top + (1 - (v - min) / (max - min)) * (opts.bottom - opts.top)
  const x = (i: number) => ((i + 0.5) / n) * opts.w
  const path = (vs: readonly (number | null)[]) => {
    let d = ''
    let pen = false
    vs.forEach((v, i) => {
      if (!finite(v)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  // Band only across runs where both values are known.
  let band = ''
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) {
      band += `M${run.map((i) => `${x(i).toFixed(1)},${y(his[i] as number).toFixed(1)}`).join(' L')} `
      band += `L${[...run].reverse().map((i) => `${x(i).toFixed(1)},${y(los[i] as number).toFixed(1)}`).join(' L')} Z `
    }
    run = []
  }
  for (let i = 0; i < n; i++) {
    if (finite(his[i]) && finite(los[i])) run.push(i)
    else flush()
  }
  flush()
  const zeroY = opts.freezing >= min && opts.freezing <= max ? y(opts.freezing) : null
  return { hi: path(his), lo: path(los), band: band.trim(), zeroY, y, min, max }
}

/** Line + area paths for an hourly series over `w × h` (x by index). Unknown values break the line and the area. */
export function seriesGeometry(
  vs: readonly (number | null)[],
  opts: { w: number; top: number; bottom: number; minSpan?: number },
): { line: string; area: string; y: (v: number) => number; x: (i: number) => number; min: number; max: number } | null {
  const known = vs.filter(finite)
  if (!known.length) return null
  let min = Math.min(...known)
  let max = Math.max(...known)
  const span = Math.max(opts.minSpan ?? 1, max - min)
  const mid = (min + max) / 2
  min = mid - span / 2 - span * 0.12
  max = mid + span / 2 + span * 0.12
  const n = vs.length
  const x = (i: number) => (n <= 1 ? opts.w / 2 : (i / (n - 1)) * opts.w)
  const y = (v: number) => opts.top + (1 - (v - min) / (max - min)) * (opts.bottom - opts.top)
  let line = ''
  let area = ''
  let seg: number[] = []
  const flush = () => {
    if (seg.length) {
      const pts = seg.map((i) => `${x(i).toFixed(1)},${y(vs[i] as number).toFixed(1)}`)
      line += `M${pts.join(' L')} `
      if (seg.length > 1) area += `M${x(seg[0]).toFixed(1)},${opts.bottom} L${pts.join(' L')} L${x(seg[seg.length - 1]).toFixed(1)},${opts.bottom} Z `
    }
    seg = []
  }
  vs.forEach((v, i) => (finite(v) ? seg.push(i) : flush()))
  flush()
  return { line: line.trim(), area: area.trim(), y, x, min, max }
}

/** Month grid cells (Monday first): leading blanks, the month's dates, trailing blanks to a full week. */
export function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= dim; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}
