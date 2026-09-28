/**
 * iCalendar (RFC 5545) builder. Pure — no DB, no clock (DTSTAMP comes from the caller's `now`).
 *
 * Choices (see docs/backup.md → "Calendar export"):
 * - Trip days are all-day events: `DTSTART;VALUE=DATE` with an exclusive `DTEND;VALUE=DATE` (the day after).
 * - Timed events keep the venue's wall-clock time with `TZID=<IANA zone>` and the calendar carries a matching
 *   VTIMEZONE generated from the IANA database (via Luxon) for the years involved, so clients that do not know IANA
 *   names still place the event correctly across DST changes.
 * - UIDs are stable (derived from Piste record ids), so re-importing updates events instead of duplicating them.
 * - TEXT values are escaped (backslash, semicolon, comma, newline); lines are folded at 75 octets without splitting
 *   UTF-8 sequences; lines end with CRLF.
 */
import { DateTime } from 'luxon'

export type IcsWhen = { date: string } | { dateTime: string; tz: string }

export interface IcsEvent {
  uid: string
  summary: string
  start: IcsWhen
  /** All-day: exclusive end date. Timed: must also be timed (same zone recommended). */
  end?: IcsWhen | null
  description?: string | null
  location?: string | null
  url?: string | null
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' | null
  categories?: readonly string[]
  /** Last modification of the source record (UTC ISO), if known. */
  lastModified?: string | null
}

export interface IcsCalendar {
  name: string
  events: readonly IcsEvent[]
  /** UTC ISO instant used for DTSTAMP. */
  now: string
  description?: string | null
}

export const PRODID = '-//Piste//Piste ski planner//EN'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

// ---------------------------------------------------------------------------
// Low-level encoding

/** Escape a TEXT value (RFC 5545 §3.3.11). Control characters other than tab are removed. */
export function escapeText(s: string): string {
  return (
    s
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
  )
}

/** Fold a content line to ≤ 75 octets per physical line (continuations start with one space). */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const parts: string[] = []
  let cur = ''
  let curBytes = 0
  let limit = 75
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (curBytes + b > limit) {
      parts.push(cur)
      cur = ''
      curBytes = 0
      limit = 74 // the leading space counts toward the 75 octets
    }
    cur += ch
    curBytes += b
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

/** Only http(s) URIs, without whitespace or control characters. */
export function safeUri(url: string | null | undefined): string | null {
  if (!url) return null
  const u = url.trim()
  if (!/^https?:\/\/[^\s\u0000-\u001F\u007F]+$/i.test(u)) return null
  return u
}

/** UIDs from record ids: keep a conservative character set. */
export function uidOf(...parts: (string | number)[]): string {
  return `${parts.map((p) => String(p).replace(/[^A-Za-z0-9._-]/g, '-')).join('-')}@piste.local`
}

export function utcStamp(instant: string): string {
  const dt = DateTime.fromISO(instant, { zone: 'utc' })
  if (!dt.isValid) throw new Error(`Invalid instant: ${instant}`)
  return dt.toFormat("yyyyMMdd'T'HHmmss'Z'")
}

function icsDate(date: string): string {
  const m = DATE_RE.exec(date)
  if (!m) throw new Error(`Invalid date: ${date}`)
  return `${m[1]}${m[2]}${m[3]}`
}

function icsLocalDateTime(dt: string): string {
  const m = DATETIME_RE.exec(dt)
  if (!m) throw new Error(`Invalid local date-time: ${dt}`)
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? '00'}`
}

function whenProp(name: 'DTSTART' | 'DTEND', w: IcsWhen): string {
  if ('date' in w) return `${name};VALUE=DATE:${icsDate(w.date)}`
  return `${name};TZID=${w.tz}:${icsLocalDateTime(w.dateTime)}`
}

// ---------------------------------------------------------------------------
// VTIMEZONE from the IANA database

function fmtOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
}

const offsetAt = (ms: number, tz: string) => DateTime.fromMillis(ms, { zone: tz }).offset

export interface ZoneTransition {
  /** UTC ms of the change. */
  atMs: number
  from: number
  to: number
}

/** Offset changes of a zone within [fromYear, toYear] (hour scan, then refined to the minute). */
export function zoneTransitions(tz: string, fromYear: number, toYear: number): ZoneTransition[] {
  const start = DateTime.fromObject({ year: fromYear, month: 1, day: 1 }, { zone: 'utc' }).toMillis()
  const end = DateTime.fromObject({ year: toYear + 1, month: 1, day: 1 }, { zone: 'utc' }).toMillis()
  const HOUR = 3_600_000
  const out: ZoneTransition[] = []
  let prev = offsetAt(start, tz)
  for (let t = start + HOUR; t <= end; t += HOUR) {
    const cur = offsetAt(t, tz)
    if (cur === prev) continue
    // Offsets change on minute boundaries: binary-search the minute within this hour.
    const base = t - HOUR
    let loM = 0
    let hiM = 60
    while (hiM - loM > 1) {
      const m = (loM + hiM) >> 1
      if (offsetAt(base + m * 60_000, tz) === prev) loM = m
      else hiM = m
    }
    out.push({ atMs: base + hiM * 60_000, from: prev, to: cur })
    prev = cur
  }
  return out
}

/** VTIMEZONE lines for `tz`, covering the given years (plus the year before, so the first event is covered). */
export function vtimezone(tz: string, years: readonly number[]): string[] {
  if (!DateTime.local().setZone(tz).isValid) throw new Error(`Invalid IANA timezone: ${tz}`)
  const minY = Math.min(...years) - 1
  const maxY = Math.max(...years)
  const trans = zoneTransitions(tz, minY, maxY)
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`]
  const name = (ms: number) => DateTime.fromMillis(ms, { zone: tz }).setLocale('en-US').offsetNameShort ?? fmtOffset(offsetAt(ms, tz))
  if (trans.length === 0) {
    const off = offsetAt(DateTime.fromObject({ year: maxY, month: 1, day: 1 }, { zone: 'utc' }).toMillis(), tz)
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${fmtOffset(off)}`, `TZOFFSETTO:${fmtOffset(off)}`, `TZNAME:${escapeText(name(Date.UTC(maxY, 0, 1)))}`, 'END:STANDARD')
  } else {
    for (const t of trans) {
      // DTSTART of an observance is the local time of the onset, expressed in the offset in effect before it.
      const local = DateTime.fromMillis(t.atMs + t.from * 60_000, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss")
      const kind = t.to > t.from ? 'DAYLIGHT' : 'STANDARD'
      lines.push(`BEGIN:${kind}`, `DTSTART:${local}`, `TZOFFSETFROM:${fmtOffset(t.from)}`, `TZOFFSETTO:${fmtOffset(t.to)}`, `TZNAME:${escapeText(name(t.atMs))}`, `END:${kind}`)
    }
  }
  lines.push('END:VTIMEZONE')
  return lines
}

// ---------------------------------------------------------------------------
// Calendar

export function buildIcs(cal: IcsCalendar): string {
  const stamp = utcStamp(cal.now)
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(cal.name)}`]
  if (cal.description) lines.push(`X-WR-CALDESC:${escapeText(cal.description)}`)

  const zoneYears = new Map<string, Set<number>>()
  for (const e of cal.events) {
    for (const w of [e.start, e.end]) {
      if (w && 'tz' in w) {
        const set = zoneYears.get(w.tz) ?? new Set<number>()
        set.add(Number(w.dateTime.slice(0, 4)))
        zoneYears.set(w.tz, set)
      }
    }
  }
  for (const [tz, years] of [...zoneYears].sort(([a], [b]) => a.localeCompare(b))) lines.push(...vtimezone(tz, [...years]))

  for (const e of cal.events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, whenProp('DTSTART', e.start))
    if (e.end) {
      if ('date' in e.start !== 'date' in e.end) throw new Error(`DTEND must have the same value type as DTSTART (${e.uid})`)
      lines.push(whenProp('DTEND', e.end))
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    const url = safeUri(e.url)
    if (url) lines.push(`URL:${url}`)
    if (e.status) lines.push(`STATUS:${e.status}`)
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`)
    if (e.lastModified) lines.push(`LAST-MODIFIED:${utcStamp(e.lastModified)}`)
    if ('date' in e.start) lines.push('TRANSP:TRANSPARENT')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Piste records → events

export interface TripLike {
  id: string
  name: string
  status: 'draft' | 'booked' | 'done' | 'cancelled'
  startDate: string
  endDate: string
  partySize: number
  notes: string | null
  updatedAt?: string | null
}

export interface TripItemLike {
  id: number
  type: string
  refId: string | null
  title: string
  date: string | null
  endDate: string | null
  status: 'idea' | 'draft' | 'booked'
}

export interface EventLike {
  id: string
  title: string
  category: string
  venue: string | null
  startLocal: string | null
  endLocal: string | null
  timezone: string
  status: 'announced' | 'tentative' | 'not-announced' | 'postponed' | 'cancelled'
  officialUrl: string | null
  ticketUrl: string | null
  bookingRequired: boolean | null
}

const nextDay = (date: string) => DateTime.fromISO(date, { zone: 'utc' }).plus({ days: 1 }).toISODate()!

const ITEM_LABEL: Record<string, string> = {
  'resort-day': 'Ski day',
  drive: 'Drive',
  flight: 'Flight',
  transfer: 'Transfer',
  lodging: 'Lodging',
  lesson: 'Lesson',
  rental: 'Rental',
  'lift-ticket': 'Lift ticket',
  parking: 'Parking',
  food: 'Food',
  event: 'Event',
  other: 'Plan',
}

/** An event row as an ICS event; null when no date is announced (nothing is invented). */
export function eventToIcs(e: EventLike, opts: { demo?: boolean; uid?: string } = {}): IcsEvent | null {
  if (!e.startLocal) return null
  const prefix = opts.demo ? '[DEMO] ' : ''
  const status = e.status === 'cancelled' ? 'CANCELLED' : e.status === 'announced' ? 'CONFIRMED' : 'TENTATIVE'
  const notes = [
    e.category ? `Category: ${e.category}` : null,
    e.status !== 'announced' ? `Status: ${e.status}` : null,
    e.bookingRequired === true ? 'Booking required' : null,
    e.ticketUrl && e.ticketUrl !== e.officialUrl ? `Tickets: ${e.ticketUrl}` : null,
    DATETIME_RE.test(e.startLocal) ? `Times are local to the venue (${e.timezone}).` : null,
    'Confirm details with the organizer.',
    opts.demo ? 'DEMO DATA — not a real listing.' : null,
  ].filter(Boolean)
  const base = {
    uid: opts.uid ?? uidOf(opts.demo ? 'demo-event' : 'event', e.id),
    summary: `${prefix}${e.title}`,
    description: notes.join('\n'),
    location: e.venue,
    url: e.officialUrl ?? e.ticketUrl,
    status,
    categories: [opts.demo ? 'Piste (demo)' : 'Piste', e.category].filter(Boolean),
  } satisfies Partial<IcsEvent>
  if (DATE_RE.test(e.startLocal)) {
    const endDate = e.endLocal ? e.endLocal.slice(0, 10) : e.startLocal
    return { ...base, start: { date: e.startLocal }, end: { date: nextDay(endDate >= e.startLocal ? endDate : e.startLocal) } }
  }
  if (DATETIME_RE.test(e.startLocal)) {
    const end = e.endLocal && DATETIME_RE.test(e.endLocal) && e.endLocal > e.startLocal ? { dateTime: e.endLocal, tz: e.timezone } : null
    return { ...base, start: { dateTime: e.startLocal, tz: e.timezone }, end }
  }
  return null
}

/** A trip as one all-day span plus one event per dated item (timed where the item is a timed event). */
export function tripToIcs(trip: TripLike, items: readonly TripItemLike[], eventRows: readonly EventLike[], opts: { demo?: boolean } = {}): IcsEvent[] {
  const prefix = opts.demo ? '[DEMO] ' : ''
  const tag = opts.demo ? 'demo-trip' : 'trip'
  const out: IcsEvent[] = [
    {
      uid: uidOf(tag, trip.id),
      summary: `${prefix}${trip.name}`,
      start: { date: trip.startDate },
      end: { date: nextDay(trip.endDate) },
      description: [
        `Party of ${trip.partySize}`,
        trip.status === 'draft' ? 'Draft plan — not booked' : null,
        trip.notes,
        opts.demo ? 'DEMO DATA — not a real trip.' : null,
      ]
        .filter(Boolean)
        .join('\n'),
      status: trip.status === 'cancelled' ? 'CANCELLED' : trip.status === 'draft' ? 'TENTATIVE' : 'CONFIRMED',
      categories: [opts.demo ? 'Piste (demo)' : 'Piste', 'Trip'],
      lastModified: trip.updatedAt ?? null,
    },
  ]
  const byId = new Map(eventRows.map((e) => [e.id, e]))
  for (const item of [...items].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id - b.id)) {
    if (!item.date) continue
    const uid = uidOf(tag, trip.id, 'item', item.id)
    const itemStatus = trip.status === 'cancelled' ? 'CANCELLED' : item.status === 'booked' ? 'CONFIRMED' : 'TENTATIVE'
    const ev = item.type === 'event' && item.refId ? byId.get(item.refId) : undefined
    const timed = ev ? eventToIcs(ev, { demo: opts.demo, uid }) : null
    if (timed) {
      out.push({ ...timed, status: trip.status === 'cancelled' ? 'CANCELLED' : timed.status })
      continue
    }
    const end = item.endDate && item.endDate >= item.date ? item.endDate : item.date
    out.push({
      uid,
      summary: `${prefix}${ITEM_LABEL[item.type] ?? 'Plan'}: ${item.title}`,
      start: { date: item.date },
      // Lodging end dates are check-out days; other items include their end date.
      end: { date: item.type === 'lodging' && item.endDate && item.endDate > item.date ? item.endDate : nextDay(end) },
      description: [`Part of "${trip.name}"`, item.status === 'booked' ? 'Booked' : 'Not booked yet'].join('\n'),
      status: itemStatus,
      categories: [opts.demo ? 'Piste (demo)' : 'Piste', ITEM_LABEL[item.type] ?? 'Plan'],
    })
  }
  return out
}
