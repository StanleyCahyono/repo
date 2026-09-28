import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, eventToIcs, foldLine, tripToIcs, vtimezone, zoneTransitions, type EventLike, type TripLike } from './ics'

const NOW = '2027-01-15T14:00:00.000Z'
const unfold = (ics: string) => ics.replace(/\r\n /g, '')

describe('RFC 5545 encoding', () => {
  it('escapes backslash, semicolon, comma and newlines in TEXT values', () => {
    expect(escapeText('Après-ski; bring gloves, goggles\nC:\\maps')).toBe('Après-ski\\; bring gloves\\, goggles\\nC:\\\\maps')
    expect(escapeText('a\r\nb\rc')).toBe('a\\nb\\nc')
    expect(escapeText('bell\u0007')).toBe('bell')
  })

  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const line = `DESCRIPTION:${'é'.repeat(80)}`
    const folded = foldLine(line)
    const enc = new TextEncoder()
    for (const physical of folded.split('\r\n')) expect(enc.encode(physical).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })
})

const trip: TripLike = { id: 'trip-alta-feb', name: 'Alta, February', status: 'booked', startDate: '2027-02-12', endDate: '2027-02-15', partySize: 2, notes: null }

describe('trip export', () => {
  it('writes trip days as all-day events with an exclusive end date and stable UIDs', () => {
    const events = tripToIcs(trip, [{ id: 7, type: 'resort-day', refId: 'alta', title: 'Alta', date: '2027-02-13', endDate: null, status: 'draft' }], [])
    const ics = buildIcs({ name: 'Piste — Alta, February', events, now: NOW })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
    const u = unfold(ics)
    expect(u).toContain('DTSTART;VALUE=DATE:20270212\r\nDTEND;VALUE=DATE:20270216')
    expect(u).toContain('UID:trip-trip-alta-feb@piste.local')
    expect(u).toContain('UID:trip-trip-alta-feb-item-7@piste.local')
    expect(u).toContain('DTSTART;VALUE=DATE:20270213\r\nDTEND;VALUE=DATE:20270214')
    expect(u).toContain('SUMMARY:Alta\\, February')
    expect(u).toContain('DTSTAMP:20270115T140000Z')
    // Same input → same UIDs (re-import updates instead of duplicating).
    expect(tripToIcs(trip, [], []).map((e) => e.uid)).toEqual([events[0].uid])
  })

  it('labels demo exports', () => {
    const [e] = tripToIcs(trip, [], [], { demo: true })
    expect(e.summary).toBe('[DEMO] Alta, February')
    expect(e.uid).toMatch(/^demo-trip-/)
    expect(e.description).toMatch(/DEMO DATA/)
  })
})

const event: EventLike = {
  id: 'alta-torchlight',
  title: 'Torchlight parade',
  category: 'festival',
  venue: 'Albion Base, Alta',
  startLocal: '2027-03-13T18:30',
  endLocal: '2027-03-13T20:00',
  timezone: 'America/Denver',
  status: 'announced',
  officialUrl: 'https://www.alta.com/events',
  ticketUrl: null,
  bookingRequired: false,
}

describe('timed events', () => {
  it('keeps venue wall time with TZID and includes a VTIMEZONE with the real DST transitions', () => {
    const ics = unfold(buildIcs({ name: 'Piste', events: [eventToIcs(event)!], now: NOW }))
    expect(ics).toContain('DTSTART;TZID=America/Denver:20270313T183000')
    expect(ics).toContain('DTEND;TZID=America/Denver:20270313T200000')
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Denver')
    // 2027: DST starts 14 Mar 02:00 MST (−0700 → −0600) and ends 7 Nov 02:00 MDT.
    expect(ics).toContain('BEGIN:DAYLIGHT\r\nDTSTART:20270314T020000\r\nTZOFFSETFROM:-0700\r\nTZOFFSETTO:-0600\r\nTZNAME:MDT')
    expect(ics).toContain('BEGIN:STANDARD\r\nDTSTART:20271107T020000\r\nTZOFFSETFROM:-0600\r\nTZOFFSETTO:-0700\r\nTZNAME:MST')
    expect(ics).toContain('LOCATION:Albion Base\\, Alta')
    expect(ics).toContain('URL:https://www.alta.com/events')
  })

  it('finds exact transition instants, and a single observance for zones without DST', () => {
    const t = zoneTransitions('Europe/Vienna', 2027, 2027)
    expect(t.map((x) => new Date(x.atMs).toISOString())).toEqual(['2027-03-28T01:00:00.000Z', '2027-10-31T01:00:00.000Z'])
    const phoenix = vtimezone('America/Phoenix', [2027])
    expect(phoenix).toContain('DTSTART:19700101T000000')
    expect(phoenix.filter((l) => l.startsWith('BEGIN:')).length).toBe(2) // VTIMEZONE + STANDARD
  })

  it('exports announced all-day events and refuses to invent a date for unannounced ones', () => {
    const allDay = eventToIcs({ ...event, startLocal: '2027-02-20', endLocal: '2027-02-21' })!
    expect(allDay.start).toEqual({ date: '2027-02-20' })
    expect(allDay.end).toEqual({ date: '2027-02-22' })
    expect(eventToIcs({ ...event, startLocal: null, status: 'not-announced' })).toBeNull()
    expect(eventToIcs({ ...event, status: 'cancelled' })!.status).toBe('CANCELLED')
    // A timed start with a date-only end cannot carry DTEND of a different type.
    expect(eventToIcs({ ...event, endLocal: '2027-03-14' })!.end).toBeNull()
  })

  it('rejects non-http URLs', () => {
    const ics = buildIcs({ name: 'x', events: [{ ...eventToIcs(event)!, url: 'javascript:alert(1)' }], now: NOW })
    expect(ics).not.toContain('URL:')
  })
})
