/**
 * api.weather.gov gridpoint values are ISO-8601 intervals: `validTime: "2027-01-15T06:00:00+00:00/PT6H"` means the
 * value applies to [06:00Z, 12:00Z). We turn every layer into whole UTC hour slots [H, H+1h):
 *
 * - Accumulations (snowfallAmount, quantitativePrecipitation) are TOTALS over the interval. Each hour receives the
 *   share of the total proportional to its overlap with the interval (6 mm over PT6H → 1 mm per hour). A slot is
 *   only reported when the layer covers it exactly once: partially covered edge hours are null (not an
 *   under-count), and hours covered by overlapping or duplicate intervals are null too (ambiguous, never a double
 *   count). The total is conserved across the reported hours.
 * - Instantaneous/representative values (temperature, wind, gust, humidity …) apply to the whole interval, so
 *   every overlapped hour gets the value; if two intervals share an hour the one covering more of it wins.
 *
 * Interval bounds must state their offset (NWS always does); an offset-less stamp is unparseable rather than read
 * in the server's zone. A `null` value in the source stays null. Nothing is interpolated or invented.
 */
import { DateTime, Duration } from 'luxon'
import { hasExplicitOffset } from '../result'

export const HOUR_MS = 3_600_000

export interface NwsValue {
  validTime: string
  value: number | null
}

export interface ParsedInterval {
  startMs: number
  endMs: number
}

/** Parse `start/duration` or `start/end` ISO-8601 intervals. Null when unparseable, offset-less or empty. */
export function parseValidTime(validTime: string): ParsedInterval | null {
  const [a, b] = validTime.split('/')
  if (!a || !b || !hasExplicitOffset(a)) return null
  const start = DateTime.fromISO(a, { setZone: true })
  if (!start.isValid) return null
  let end: DateTime
  if (b.startsWith('P')) {
    const dur = Duration.fromISO(b)
    if (!dur.isValid) return null
    end = start.plus(dur)
  } else {
    if (!hasExplicitOffset(b)) return null
    end = DateTime.fromISO(b, { setZone: true })
    if (!end.isValid) return null
  }
  const startMs = start.toMillis()
  const endMs = end.toMillis()
  if (!(endMs > startMs)) return null
  return { startMs, endMs }
}

export type LayerKind = 'sum' | 'instant'

export interface HourValue {
  value: number | null
  /** Milliseconds of this hour covered by source intervals. */
  coveredMs: number
}

/**
 * Distribute one gridpoint layer onto UTC hour slots. `convert` maps the source unit to the canonical unit and is
 * applied before distribution. Returns hour-start ms → value (null when the source value is null or, for sums, the
 * hour is not covered exactly once).
 */
export function distributeToHours(values: readonly NwsValue[], kind: LayerKind, convert: (v: number) => number = (v) => v): Map<number, number | null> {
  const acc = new Map<number, { sum: number; covered: number; hasNull: boolean; best: number | null; bestOverlap: number }>()
  for (const v of values) {
    const iv = parseValidTime(v.validTime)
    if (!iv) continue
    const total = iv.endMs - iv.startMs
    const firstHour = Math.floor(iv.startMs / HOUR_MS) * HOUR_MS
    for (let h = firstHour; h < iv.endMs; h += HOUR_MS) {
      const overlap = Math.min(h + HOUR_MS, iv.endMs) - Math.max(h, iv.startMs)
      if (overlap <= 0) continue
      const slot = acc.get(h) ?? { sum: 0, covered: 0, hasNull: false, best: null, bestOverlap: 0 }
      slot.covered += overlap
      if (v.value === null || !Number.isFinite(v.value)) {
        slot.hasNull = true
      } else if (kind === 'sum') {
        slot.sum += convert(v.value) * (overlap / total)
      } else if (overlap >= slot.bestOverlap) {
        slot.best = convert(v.value)
        slot.bestOverlap = overlap
      }
      acc.set(h, slot)
    }
  }
  const out = new Map<number, number | null>()
  for (const [h, s] of acc) {
    if (kind === 'sum') {
      // Exactly one hour of coverage: less is a partial edge hour, more means overlapping intervals (ambiguous).
      const exact = s.covered >= HOUR_MS - 1 && s.covered <= HOUR_MS + 1
      out.set(h, exact && !s.hasNull ? Math.round(s.sum * 10_000) / 10_000 : null)
    } else {
      out.set(h, s.best === null ? null : Math.round(s.best * 10_000) / 10_000)
    }
  }
  return out
}
