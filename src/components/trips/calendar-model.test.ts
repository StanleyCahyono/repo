import { describe, expect, it } from 'vitest'
import { addMonths, bandSegment, daysInMonth, monthGrid, nightsOf, pickDay, weekdayIndex } from './calendar-model'
import { markOn, seasonWindows } from '@/lib/data/trip-seasons'

describe('calendar model', () => {
  it('lays out a Monday-first month', () => {
    expect(weekdayIndex('2026-11-01')).toBe(6) // Sunday
    const weeks = monthGrid('2026-11')
    expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(weeks[0][6]).toBe('2026-11-01')
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('handles month arithmetic and leap years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2027-02')).toBe(28)
  })

  it('picks a start, then an end; tapping earlier restarts', () => {
    expect(pickDay(null, null, '2026-11-27')).toEqual({ start: '2026-11-27', end: null })
    expect(pickDay('2026-11-27', null, '2026-11-29')).toEqual({ start: '2026-11-27', end: '2026-11-29' })
    expect(pickDay('2026-11-27', null, '2026-11-27')).toEqual({ start: '2026-11-27', end: '2026-11-27' })
    expect(pickDay('2026-11-27', null, '2026-11-20')).toEqual({ start: '2026-11-20', end: null })
    expect(pickDay('2026-11-27', '2026-11-29', '2026-12-02')).toEqual({ start: '2026-12-02', end: null })
  })

  it('draws the band per week row and counts nights', () => {
    const weeks = monthGrid('2026-11')
    const row = weeks.find((w) => w.includes('2026-11-27'))!
    expect(bandSegment(row, '2026-11-27', '2026-12-02')).toEqual({ c0: 4, c1: 6, startsHere: true, endsHere: false })
    expect(bandSegment(row, null, null)).toBeNull()
    expect(nightsOf('2026-11-27', '2026-11-29')).toEqual({ nights: 2, days: 3 })
  })
})

describe('season windows', () => {
  const base = { seasonId: '2026-27', announcedOpening: null, estimatedOpenFrom: null, estimatedOpenTo: null, actualOpening: null, announcedClosing: null, actualClosing: null }

  it('labels a Piste estimate and caps an open-ended window at the hemisphere season end', () => {
    const [w] = seasonWindows([{ ...base, estimatedOpenFrom: '2026-11-28', estimatedOpenTo: '2026-12-05' }], 42.5, '2026-10-01')
    expect(w).toMatchObject({ kind: 'estimate', from: '2026-11-28', to: '2027-04-30', openEnded: true })
    expect(w.label).toContain('Piste estimate')
  })

  it('never turns an announced opening into opened', () => {
    const [w] = seasonWindows([{ ...base, announcedOpening: '2026-11-01', announcedClosing: '2027-05-03' }], 46, '2026-10-01')
    expect(w).toMatchObject({ kind: 'announced', to: '2027-05-03', openEnded: false })
  })

  it('drops seasons that ended before today and prefers the strongest mark', () => {
    expect(seasonWindows([{ ...base, seasonId: '2025-26', actualOpening: '2025-11-28', actualClosing: '2026-03-29' }], 42.5, '2026-10-01')).toEqual([])
    const tracks = [
      { resortId: 'a', name: 'A', windows: seasonWindows([{ ...base, estimatedOpenFrom: '2026-11-20' }], 42, '2026-10-01') },
      { resortId: 'b', name: 'B', windows: seasonWindows([{ ...base, announcedOpening: '2026-11-25' }], 42, '2026-10-01') },
    ]
    expect(markOn(tracks, '2026-11-21')?.kind).toBe('estimate')
    expect(markOn(tracks, '2026-11-26')?.kind).toBe('announced')
    expect(markOn(tracks, '2026-11-01')).toBeNull()
  })

  it('caps southern-hemisphere seasons at 31 Oct', () => {
    const [w] = seasonWindows([{ ...base, estimatedOpenFrom: '2027-06-07' }], -36.5, '2026-10-01')
    expect(w.to).toBe('2027-10-31')
  })
})
