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

/**
 * Season id for a local date in the Northern Hemisphere (and the planning season): seasons run 1 Jul → 30 Jun,
 * e.g. 2027-01-15 → '2026-27'. For a date at a resort use `seasonIdForResort`: Southern Hemisphere winters differ.
 */
export function seasonIdFor(date: string): string {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const start = m >= 7 ? y : y - 1
  return seasonIdFromStartYear(start)
}

const seasonIdFromStartYear = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// Hemispheres
//
// A season id names the planning season (e.g. '2026-27': the Northern Hemisphere winter of 2026–27, and the season
// a 2026-27 Ikon or Epic pass covers). A Southern Hemisphere winter runs about June–October of ONE calendar year Y;
// it is season '(Y-1)-(YY)' — the 2027 winter in Australia or New Zealand is '2026-27', which is what 2026-27 passes
// cover there. So at a Southern Hemisphere resort the season boundary is 1 January, not 1 July.

export type Hemisphere = 'north' | 'south'

/** Southern Hemisphere when the latitude is below the equator; unknown/invalid latitudes count as northern. */
export function hemisphereOf(lat: number | null | undefined): Hemisphere {
  return typeof lat === 'number' && Number.isFinite(lat) && lat < 0 ? 'south' : 'north'
}

/** Season id of a local date in a hemisphere: north 1 Jul → 30 Jun; south the calendar year's winter (1 Jan → 31 Dec). */
export function seasonIdForHemisphere(date: string, hemisphere: Hemisphere): string {
  return hemisphere === 'south' ? seasonIdFromStartYear(Number(date.slice(0, 4)) - 1) : seasonIdFor(date)
}

/** Season id of a resort-local date at a resort (by the resort's latitude). */
export function seasonIdForResort(date: string, resort: { lat: number | null | undefined }): string {
  return seasonIdForHemisphere(date, hemisphereOf(resort.lat))
}

/** Season of a (resort, date) pair — resolves the resort's hemisphere by id. */
export type SeasonOf = (resortId: string | null | undefined, date: string) => string

/** Every resort in the Northern Hemisphere (the behaviour when resort latitudes are not known). */
export const northernSeasonOf: SeasonOf = (_resortId, date) => seasonIdFor(date)

/** A `SeasonOf` for a set of resorts: Southern Hemisphere resorts (by latitude) use the calendar-year winter. */
export function seasonResolver(resorts: Iterable<{ id: string; lat: number | null | undefined }>): SeasonOf {
  const south = new Set<string>()
  for (const r of resorts) if (hemisphereOf(r.lat) === 'south') south.add(r.id)
  if (!south.size) return northernSeasonOf
  return (resortId, date) => seasonIdForHemisphere(date, resortId && south.has(resortId) ? 'south' : 'north')
}

function startYearOf(seasonId: string): number {
  const m = /^(\d{4})-\d{2}$/.exec(seasonId)
  if (!m) throw new Error(`Invalid season id: ${seasonId}`)
  return Number(m[1])
}

/** '2026-27' → '2027-28'. */
export function nextSeasonId(seasonId: string): string {
  return seasonIdFromStartYear(startYearOf(seasonId) + 1)
}

/** '2026-27' → '2025-26'. */
export function previousSeasonId(seasonId: string): string {
  return seasonIdFromStartYear(startYearOf(seasonId) - 1)
}

/** The dates a season id covers in a hemisphere: north 1 Jul → 30 Jun, south 1 Jan → 31 Dec of the winter's year. */
export function seasonBounds(seasonId: string, hemisphere: Hemisphere = 'north'): { from: string; to: string } {
  const y = startYearOf(seasonId)
  return hemisphere === 'south' ? { from: `${y + 1}-01-01`, to: `${y + 1}-12-31` } : { from: `${y}-07-01`, to: `${y + 1}-06-30` }
}

/**
 * The span of the planning season across hemispheres: 1 Jul of its first year, through 31 Dec of its second year
 * when Southern Hemisphere resorts are involved (their 2026-27 winter is June–October 2027), else 30 Jun.
 */
export function planningSeasonBounds(seasonId: string, withSouthern: boolean): { from: string; to: string } {
  const north = seasonBounds(seasonId, 'north')
  return withSouthern ? { from: north.from, to: seasonBounds(seasonId, 'south').to } : north
}

/** Months a season is drawn over (a display window, not a closing rule): north 1 Nov → 30 Apr, south 1 May → 31 Oct. */
export function skiWindow(seasonId: string, hemisphere: Hemisphere = 'north'): { from: string; to: string } {
  const y = startYearOf(seasonId)
  return hemisphere === 'south' ? { from: `${y + 1}-05-01`, to: `${y + 1}-10-31` } : { from: `${y}-11-01`, to: `${y + 1}-04-30` }
}

/** Season ids a set of local dates can fall in at any resort (both hemispheres) — for loading season rows. */
export function seasonIdsForDates(dates: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const d of dates) {
    out.add(seasonIdFor(d))
    out.add(seasonIdForHemisphere(d, 'south'))
  }
  return [...out]
}
