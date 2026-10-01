/**
 * Pure helpers behind the chart primitives: domains, ticks, nearest-point lookup, provider interval semantics and
 * shaded ranges. No React, no DOM — unit-tested in scale.test.ts.
 *
 * Time on the x-axis is always UTC milliseconds. Labels are never computed with the browser's local time: callers
 * pass resort-local labels (e.g. `localTime: '14:00'`, `localDate: '2027-01-16'`) computed on the server with the
 * resort's IANA zone, so ticks land on resort-local hours whatever the viewer's zone is.
 */
import { ticks as d3Ticks } from 'd3-array'

export const HOUR_MS = 3_600_000

/** A timestamp with its resort-local wall-clock labels. */
export interface LocalStamp {
  /** UTC milliseconds. */
  t: number
  /** Resort-local 'YYYY-MM-DD'. */
  localDate: string
  /** Resort-local 'HH:mm'. */
  localTime: string
}

export interface TimeTick {
  t: number
  label: string
  /** Local midnight: drawn a little stronger. */
  major: boolean
}

export interface DayMark {
  /** First stamp of the local day (UTC ms). */
  t: number
  date: string
  label: string
}

export interface Range {
  from: number
  to: number
}

export type IntervalSemantics = 'preceding-hour' | 'following-hour' | 'instant'

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Local hour (0–23) from an 'HH:mm' label; NaN when malformed. */
export function hourOf(localTime: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(localTime)
  return m ? Number(m[1]) : Number.NaN
}

/**
 * The smallest step (hours) from `steps` that keeps tick labels at least `minPx` apart for `hours` hours spread
 * over `plotWidth` pixels.
 */
export function tickStep(plotWidth: number, hours: number, minPx = 44, steps: readonly number[] = [1, 2, 3, 6, 12, 24]): number {
  if (plotWidth <= 0 || hours <= 0) return steps[steps.length - 1]
  const pxPerHour = plotWidth / hours
  return steps.find((s) => s * pxPerHour >= minPx) ?? steps[steps.length - 1]
}

/** Hour ticks on resort-local multiples of `step` (whole hours only). Local midnights are `major`. */
export function hourTicks(stamps: readonly LocalStamp[], step: number): TimeTick[] {
  return stamps
    .filter((s) => s.localTime.endsWith(':00') && hourOf(s.localTime) % step === 0)
    .map((s) => ({ t: s.t, label: s.localTime, major: s.localTime === '00:00' }))
}

/**
 * Local day boundaries: the first stamp of every resort-local date after the first one (the chart's own left edge
 * is not a boundary). `label` formats the date, e.g. 'Sat 16'.
 */
export function dayMarks(stamps: readonly LocalStamp[], label: (date: string) => string): DayMark[] {
  const out: DayMark[] = []
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i].localDate !== stamps[i - 1].localDate) out.push({ t: stamps[i].t, date: stamps[i].localDate, label: label(stamps[i].localDate) })
  }
  return out
}

export interface LabelSlot {
  x: number
  anchor: 'start' | 'middle' | 'end'
  /** False when the label would touch a neighbour (the tick mark still shows). */
  show: boolean
}

/** Rough rendered width of a 12px Plex label (tabular digits ≈ 6.9px). */
export const labelWidth = (text: string, charPx = 6.9) => text.length * charPx + 2

/**
 * Tick labels along a time axis: centred on their tick, kept inside [left, right] (anchored start/end at the edges)
 * and hidden left-to-right when they would come within `gap` px of the previous shown label.
 */
export function placeTickLabels(xs: readonly number[], texts: readonly string[], left: number, right: number, gap = 6): LabelSlot[] {
  let lastEnd = -Infinity
  return xs.map((x, i) => {
    const w = labelWidth(texts[i] ?? '')
    let anchor: LabelSlot['anchor'] = 'middle'
    let x0 = x - w / 2
    if (x0 < left) {
      anchor = 'start'
      x0 = x
    } else if (x + w / 2 > right) {
      anchor = 'end'
      x0 = x - w
    }
    const show = x0 >= lastEnd + gap && x0 + w <= right + 1
    if (show) lastEnd = x0 + w
    return { x, anchor, show }
  })
}

/**
 * Day labels drawn from their day's start (never left of `left`). Placed right-to-left so a full day keeps its label
 * and a short partial day at the left edge gives way when the two would collide.
 */
export function placeDayLabels(xs: readonly number[], texts: readonly string[], left: number, right: number, gap = 8): LabelSlot[] {
  const out: LabelSlot[] = xs.map((x) => ({ x: Math.max(left, x) + (x > left ? 3 : 0), anchor: 'start', show: false }))
  let nextStart = right + 1
  for (let i = xs.length - 1; i >= 0; i--) {
    const end = out[i].x + labelWidth(texts[i] ?? '')
    if (end <= nextStart - (nextStart > right ? 0 : gap)) {
      out[i].show = true
      nextStart = out[i].x
    }
  }
  return out
}

/** Index of the value in ascending `ts` nearest to `t` (ties go to the earlier one). -1 for an empty list. */
export function nearestIndex(ts: readonly number[], t: number): number {
  if (!ts.length) return -1
  let lo = 0
  let hi = ts.length - 1
  if (t <= ts[lo]) return lo
  if (t >= ts[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= t) lo = mid
    else hi = mid
  }
  return t - ts[lo] <= ts[hi] - t ? lo : hi
}

/** Clamp an index into [0, n − 1]; null stays null. */
export function clampIndex(i: number | null, n: number): number | null {
  if (i === null || n <= 0) return null
  return Math.min(n - 1, Math.max(0, i))
}

/**
 * The interval an hourly value describes, as [start, end) in UTC ms, under the provider's documented semantics:
 * 'preceding-hour' (Open-Meteo sums): stamp T covers (T − 1 h, T]; 'following-hour': [T, T + 1 h); 'instant': the
 * hour centred on T.
 */
export function hourInterval(t: number, semantics: IntervalSemantics): [number, number] {
  if (semantics === 'preceding-hour') return [t - HOUR_MS, t]
  if (semantics === 'following-hour') return [t, t + HOUR_MS]
  return [t - HOUR_MS / 2, t + HOUR_MS / 2]
}

export interface DomainOptions {
  /** Always include 0 (bars, accumulations, speeds). */
  includeZero?: boolean
  /** Minimum top for a zero-based axis, so a trace of snow doesn't fill the panel. */
  floorMax?: number
  /** Minimum span (top − bottom) for non-zero-based axes such as temperature. */
  minSpan?: number
  /** Extra values that must be visible (reference lines). */
  extra?: readonly (number | null | undefined)[]
  /** Values above this are clamped (e.g. visibility "16+ km"). */
  clampMax?: number
}

/**
 * A readable y-domain for measured values, rounded outward to nice numbers. Unknown (null) values are ignored —
 * never treated as zero. Null when there is nothing to plot.
 */
export function valueDomain(values: readonly (number | null | undefined)[], opts: DomainOptions = {}): [number, number] | null {
  const vs = values.filter(isNum).map((v) => (opts.clampMax !== undefined ? Math.min(v, opts.clampMax) : v))
  if (!vs.length) return null
  const all = [...vs, ...(opts.extra ?? []).filter(isNum)]
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (opts.includeZero) {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  if (opts.floorMax !== undefined && lo >= 0) hi = Math.max(hi, opts.floorMax)
  if (opts.minSpan !== undefined && hi - lo < opts.minSpan) {
    if (opts.includeZero && lo >= 0) hi = lo + opts.minSpan
    else {
      const mid = (hi + lo) / 2
      lo = mid - opts.minSpan / 2
      hi = mid + opts.minSpan / 2
    }
  }
  if (hi === lo) hi = lo + 1
  const step = niceStep(hi - lo, 4)
  // Tolerance: 0.4 / 0.1 is 4.000000000000001 in floating point, which must not add a whole extra step.
  const bottom = Math.floor(lo / step + 1e-9) * step
  let top = Math.ceil(hi / step - 1e-9) * step
  if (opts.clampMax !== undefined && top > opts.clampMax) top = opts.clampMax
  return [roundTo(bottom, step), roundTo(top, step)]
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return nice * mag
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(v.toFixed(Math.min(6, decimals)))
}

/** Tick values for a linear domain (d3's nice ticks), at most `count`-ish. */
export function linearTicks(domain: readonly [number, number], count = 4): number[] {
  return d3Ticks(domain[0], domain[1], count)
}

/** Contiguous runs of items matching `pred`, as [from, to) ranges from each item's interval. */
export function runsOf<T>(items: readonly T[], pred: (x: T) => boolean, span: (x: T) => [number, number]): Range[] {
  const out: Range[] = []
  let cur: Range | null = null
  for (const it of items) {
    if (pred(it)) {
      const [a, b] = span(it)
      if (cur && a <= cur.to) cur.to = Math.max(cur.to, b)
      else {
        cur = { from: a, to: b }
        out.push(cur)
      }
    } else cur = null
  }
  return out
}

export interface KnownSum {
  /** Sum over known values; null when no value is known (unknown is not zero). */
  sum: number | null
  known: number
  total: number
  /** Every item had a value. */
  complete: boolean
}

export function sumKnown(values: readonly (number | null | undefined)[]): KnownSum {
  const vs = values.filter(isNum)
  return {
    sum: vs.length ? vs.reduce((a, b) => a + b, 0) : null,
    known: vs.length,
    total: values.length,
    complete: vs.length === values.length && values.length > 0,
  }
}

export function extentKnown(values: readonly (number | null | undefined)[]): [number, number] | null {
  const vs = values.filter(isNum)
  return vs.length ? [Math.min(...vs), Math.max(...vs)] : null
}

/** True when at least one value is known. */
export function anyKnown(values: readonly (number | null | undefined)[]): boolean {
  return values.some(isNum)
}
