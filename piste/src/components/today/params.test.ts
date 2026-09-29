import { describe, expect, it } from 'vitest'
import {
  clampRange,
  datesOf,
  datesPatch,
  finderRange,
  formatDates,
  nextWeekendOf,
  parseTodayParams,
  patchQuery,
  quickPatch,
  quickRangeOf,
  relativeDay,
  weekendOf,
} from './params'

// 2027-01-15 is a Friday; 2026-09-29 a Tuesday; 2027-01-16 a Saturday; 2027-01-17 a Sunday.
const FRI = '2027-01-15'

describe('weekends', () => {
  it('picks the coming Saturday–Sunday on weekdays and Saturdays', () => {
    expect(weekendOf(FRI)).toEqual({ from: '2027-01-16', to: '2027-01-17' })
    expect(weekendOf('2026-09-29')).toEqual({
      from: '2026-10-03',
      to: '2026-10-04',
    })
    expect(weekendOf('2027-01-16')).toEqual({
      from: '2027-01-16',
      to: '2027-01-17',
    })
  })
  it('keeps only Sunday when today is Sunday, and the next weekend follows', () => {
    expect(weekendOf('2027-01-17')).toEqual({
      from: '2027-01-17',
      to: '2027-01-17',
    })
    expect(nextWeekendOf('2027-01-17')).toEqual({
      from: '2027-01-23',
      to: '2027-01-24',
    })
    expect(nextWeekendOf(FRI)).toEqual({
      from: '2027-01-23',
      to: '2027-01-24',
    })
    expect(nextWeekendOf('2027-01-16')).toEqual({
      from: '2027-01-23',
      to: '2027-01-24',
    })
  })
  it('builds finder windows of at most 14 days', () => {
    expect(finderRange('7d', FRI)).toEqual({ from: FRI, to: '2027-01-21' })
    expect(finderRange('14d', FRI)).toEqual({ from: FRI, to: '2027-01-28' })
    expect(clampRange({ from: FRI, to: '2027-03-01' })).toEqual({
      from: FRI,
      to: '2027-01-28',
    })
  })
})

describe('parseTodayParams', () => {
  it('defaults to today, the ability preset and this weekend in the finder', () => {
    expect(parseTodayParams({}, FRI)).toEqual({
      date: null,
      range: null,
      preset: null,
      finder: 'weekend',
      ignored: null,
    })
  })
  it('reads a single day, a range, a preset and a finder window', () => {
    expect(parseTodayParams({ date: '2027-01-19', preset: 'best-snow', fw: '14d' }, FRI)).toEqual({
      date: '2027-01-19',
      range: null,
      preset: 'best-snow',
      finder: '14d',
      ignored: null,
    })
    expect(parseTodayParams(new URLSearchParams('from=2027-01-16&to=2027-01-17'), FRI).range).toEqual({ from: '2027-01-16', to: '2027-01-17' })
  })
  it('rejects unknown presets and windows instead of guessing', () => {
    const p = parseTodayParams({ preset: 'powder-day', fw: 'month' }, FRI)
    expect(p.preset).toBeNull()
    expect(p.finder).toBe('weekend')
  })
  it('never ranks days that have passed, and says so', () => {
    const p = parseTodayParams({ date: '2027-01-10' }, FRI)
    expect(p.date).toBeNull()
    expect(p.ignored).toMatch(/has passed/)
    const r = parseTodayParams({ from: '2027-01-01', to: '2027-01-03' }, FRI)
    expect(r.range).toBeNull()
    expect(r.ignored).toMatch(/has passed/)
  })
  it('trims a range that started earlier to today and clamps long ranges', () => {
    expect(parseTodayParams({ from: '2027-01-13', to: '2027-01-17' }, FRI).range).toEqual({ from: FRI, to: '2027-01-17' })
    expect(parseTodayParams({ from: FRI, to: '2027-02-28' }, FRI).range).toEqual({ from: FRI, to: '2027-01-28' })
  })
  it('treats a malformed or reversed range as unreadable', () => {
    expect(parseTodayParams({ from: '2027-01-17', to: '2027-01-16' }, FRI).ignored).toMatch(/could not be read/)
    expect(parseTodayParams({ date: 'soon' }, FRI).ignored).toMatch(/could not be read/)
  })
  it('collapses a one-day range and today itself to the canonical form', () => {
    expect(parseTodayParams({ from: '2027-01-16', to: '2027-01-16' }, FRI)).toMatchObject({ date: '2027-01-16', range: null })
    expect(parseTodayParams({ date: FRI }, FRI)).toMatchObject({
      date: null,
      range: null,
    })
  })
})

describe('quick ranges and patches', () => {
  it('recognises today, tomorrow and this weekend', () => {
    expect(quickRangeOf([FRI], FRI)).toBe('today')
    expect(quickRangeOf(['2027-01-16'], FRI)).toBe('tomorrow')
    expect(quickRangeOf(['2027-01-16', '2027-01-17'], FRI)).toBe('weekend')
    expect(quickRangeOf(['2027-01-19'], FRI)).toBe('custom')
  })
  it('builds query patches that round-trip through the parser', () => {
    const q = patchQuery('?preset=best-snow', quickPatch('weekend', FRI))
    expect(q).toBe('?from=2027-01-16&to=2027-01-17&preset=best-snow')
    const back = parseTodayParams(new URLSearchParams(q.slice(1)), FRI)
    expect(datesOf(back, FRI)).toEqual(['2027-01-16', '2027-01-17'])
    expect(patchQuery(q, quickPatch('today', FRI))).toBe('?preset=best-snow')
    expect(patchQuery('', datesPatch('2027-01-19', null, FRI))).toBe('?date=2027-01-19')
    expect(patchQuery('?date=2027-01-19', datesPatch(FRI, null, FRI))).toBe('')
  })
})

describe('labels', () => {
  it('formats single days and ranges compactly', () => {
    expect(formatDates([FRI])).toBe('Fri 15 Jan')
    expect(formatDates(['2027-01-16', '2027-01-17'])).toBe('Sat 16 – Sun 17 Jan')
    expect(formatDates(['2027-01-30', '2027-02-07'])).toBe('Sat 30 Jan – Sun 7 Feb')
    expect(relativeDay(FRI, FRI)).toBe('today')
    expect(relativeDay('2027-01-16', FRI)).toBe('tomorrow')
    expect(relativeDay('2027-01-19', FRI)).toBe('Tue 19 Jan')
  })
})
