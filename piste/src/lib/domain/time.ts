/**
 * Time helpers. All resort-day logic happens in the resort's IANA timezone via Luxon, so DST transitions
 * (23- and 25-hour days) are handled by the timezone database, not by adding 24h.
 *
 * - Instants: ISO-8601 UTC strings.
 * - Local calendar dates: 'YYYY-MM-DD' strings (no timezone attached; interpret with the owning resort's zone).
 */
import { DateTime, Interval } from 'luxon'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isLocalDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && DateTime.fromISO(s, { zone: 'UTC' }).isValid
}

function assertZone(tz: string) {
  if (!DateTime.local().setZone(tz).isValid) throw new Error(`Invalid IANA timezone: ${tz}`)
}

/** Resort-local calendar date of an instant. */
export function localDateOf(instant: string | Date, tz: string): string {
  assertZone(tz)
  const dt = typeof instant === 'string' ? DateTime.fromISO(instant, { zone: 'utc' }) : DateTime.fromJSDate(instant)
  if (!dt.isValid) throw new Error(`Invalid instant: ${String(instant)}`)
  return dt.setZone(tz).toISODate()!
}

/** Local hour (0–23) of an instant in a zone. */
export function localHourOf(instant: string, tz: string): number {
  return DateTime.fromISO(instant, { zone: 'utc' }).setZone(tz).hour
}

/** UTC instant of local midnight starting `date` in `tz`. */
export function startOfLocalDay(date: string, tz: string): string {
  assertZone(tz)
  const dt = DateTime.fromISO(date, { zone: tz }).startOf('day')
  if (!dt.isValid) throw new Error(`Invalid date: ${date}`)
  return dt.toUTC().toISO()!
}

/** UTC instant of the next local midnight (exclusive end of `date`). */
export function endOfLocalDay(date: string, tz: string): string {
  return DateTime.fromISO(date, { zone: tz }).startOf('day').plus({ days: 1 }).toUTC().toISO()!
}

/** Number of real hours in a local day: 24 normally, 23 or 25 on DST transitions. */
export function hoursInLocalDay(date: string, tz: string): number {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day')
  const end = start.plus({ days: 1 })
  return Interval.fromDateTimes(start, end).length('hours')
}

/** Local wall-clock time on a date → UTC instant. 'HH:mm'. Non-existent (spring-forward) times shift forward. */
export function localTimeToInstant(date: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return DateTime.fromISO(date, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO()!
}

/** Calendar arithmetic on local dates (timezone-free). */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b, { zone: 'UTC' }).diff(DateTime.fromISO(a, { zone: 'UTC' }), 'days').days)
}

/** Inclusive list of local dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  if (daysBetween(from, to) < 0) return out
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** ISO weekday 1=Mon … 7=Sun. */
export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: 'UTC' }).weekday
}

export function isWeekend(date: string): boolean {
  const w = isoWeekday(date)
  return w === 6 || w === 7
}

/** Next Saturday on or after `date` (returns `date` itself when it is a Saturday). */
export function nextSaturday(date: string): string {
  const w = isoWeekday(date)
  return addDays(date, (6 - w + 7) % 7)
}

export function isWithin(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

/** Instant difference in hours (b − a). */
export function hoursBetween(a: string, b: string): number {
  return DateTime.fromISO(b, { zone: 'utc' }).diff(DateTime.fromISO(a, { zone: 'utc' }), 'hours').hours
}

export function addHours(instant: string, hours: number): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).plus({ hours }).toUTC().toISO()!
}

/** Format an instant for display in a zone. `fmt` is a Luxon format string. */
export function formatInstant(instant: string, tz: string, fmt = "ccc d LLL, HH:mm"): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).setZone(tz).toFormat(fmt)
}

/** Short zone abbreviation for an instant, e.g. "EST", "MST", "CET". */
export function zoneAbbrev(instant: string, tz: string): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).setZone(tz).toFormat('ZZZZ')
}

export function formatLocalDate(date: string, fmt = 'ccc d LLL'): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).toFormat(fmt)
}

/** Human "3 h ago" / "in 2 d" relative label between two instants. */
export function relativeLabel(instant: string, now: string): string {
  const h = hoursBetween(instant, now)
  const abs = Math.abs(h)
  const suffix = h >= 0 ? 'ago' : 'from now'
  if (abs < 1) {
    const m = Math.round(abs * 60)
    return m <= 1 ? 'just now' : `${m} min ${suffix}`
  }
  if (abs < 48) return `${Math.round(abs)} h ${suffix}`
  return `${Math.round(abs / 24)} d ${suffix}`
}

/** Season id for a local date: seasons run 1 Jul → 30 Jun, e.g. 2027-01-15 → '2026-27'. */
export function seasonIdFor(date: string): string {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const start = m >= 7 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
