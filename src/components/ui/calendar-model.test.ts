import { describe, expect, it } from 'vitest'
import { addDays as luxonAddDays, daysBetween as luxonDaysBetween } from '@/lib/domain/time'
import {
  addDays,
  addMonths,
  addMonthsToDate,
  addYearsToDate,
  bandRange,
  bandSegment,
  canShowMonth,
  clampDate,
  columnOf,
  dayNumber,
  dayOfWeek,
  daysBetween,
  endOfWeek,
  formatDate,
  formatMonth,
  formatRange,
  fromDayNumber,
  initialFocus,
  initialMonth,
  isDisabledDay,
  isISODate,
  legendFor,
  marksOn,
  monthGrid,
  navigateDate,
  nightsLabel,
  pickRange,
  relativeDay,
  resolvePreset,
  resolvePresets,
  startOfWeek,
  weekdayHeaders,
  weekendFrom,
  windowFor,
} from './calendar-model'

describe('day numbers', () => {
  it('round-trips and agrees with the Luxon helpers', () => {
    expect(dayNumber('1970-01-01')).toBe(0)
    expect(fromDayNumber(0)).toBe('1970-01-01')
    for (const d of ['1999-12-31', '2000-02-29', '2026-10-03', '2027-03-01', '2100-02-28', '1900-03-01']) {
      expect(fromDayNumber(dayNumber(d))).toBe(d)
      expect(addDays(d, 400)).toBe(luxonAddDays(d, 400))
      expect(addDays(d, -45)).toBe(luxonAddDays(d, -45))
      expect(daysBetween(d, '2026-10-03')).toBe(luxonDaysBetween(d, '2026-10-03'))
    }
  })

  it('validates real calendar days only', () => {
    expect(isISODate('2027-02-28')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('2027-02-29')).toBe(false)
    expect(isISODate('2027-13-01')).toBe(false)
    expect(isISODate('2027-1-01')).toBe(false)
    expect(isISODate('')).toBe(false)
    expect(isISODate(null)).toBe(false)
  })
})

describe('month grid', () => {
  it('lays out a Monday-first month by default', () => {
    expect(dayOfWeek('2026-11-01')).toBe(0) // Sunday
    const weeks = monthGrid('2026-11')
    expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(weeks[0][6]).toBe('2026-11-01')
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('honours weekStartsOn', () => {
    const sunFirst = monthGrid('2026-11', 0)
    expect(sunFirst[0][0]).toBe('2026-11-01')
    expect(sunFirst).toHaveLength(5)
    expect(weekdayHeaders(0).map((h) => h.short)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    expect(weekdayHeaders(1)[5]).toEqual({ short: 'Sa', long: 'Saturday', weekend: true })
    expect(columnOf('2026-11-01', 1)).toBe(6)
    expect(columnOf('2026-11-01', 6)).toBe(1)
  })

  it('handles month arithmetic, leap years and month-end clamping', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -13)).toBe('2025-12')
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29')
    expect(addYearsToDate('2028-02-29', 1)).toBe('2029-02-28')
    expect(startOfWeek('2026-10-03')).toBe('2026-09-28')
    expect(endOfWeek('2026-10-03')).toBe('2026-10-04')
    expect(startOfWeek('2026-10-03', 0)).toBe('2026-09-27')
  })
})

describe('constraints', () => {
  const c = { min: '2026-10-03', max: '2027-04-30', isDateDisabled: (d: string) => d === '2026-12-25' }

  it('clamps and disables', () => {
    expect(clampDate('2026-01-01', c.min, c.max)).toBe('2026-10-03')
    expect(clampDate('2027-06-01', c.min, c.max)).toBe('2027-04-30')
    expect(isDisabledDay('2026-10-02', c)).toBe(true)
    expect(isDisabledDay('2026-12-25', c)).toBe(true)
    expect(isDisabledDay('2026-12-24', c)).toBe(false)
    expect(isDisabledDay('2027-05-01', c)).toBe(true)
  })

  it('bounds month navigation, counting every visible month', () => {
    expect(canShowMonth('2026-10', c)).toBe(true)
    expect(canShowMonth('2026-09', c)).toBe(false)
    expect(canShowMonth('2026-09', c, 2)).toBe(true) // Sep + Oct: October is still pickable
    expect(canShowMonth('2027-04', c)).toBe(true)
    expect(canShowMonth('2027-05', c)).toBe(false)
  })

  it('opens on the value, else today, clamped into range', () => {
    expect(initialMonth('2027-01-16', '2026-10-03', c)).toBe('2027-01')
    expect(initialMonth('', '2026-08-01', c)).toBe('2026-10')
    expect(initialFocus(null, '2027-09-01', c)).toBe('2027-04-30')
    expect(initialFocus('garbage', '2026-11-11', c)).toBe('2026-11-11')
  })

  it('keeps the visible window when focus stays inside it', () => {
    expect(windowFor('2027-02-03', '2027-01', 2)).toBe('2027-01')
    expect(windowFor('2027-03-03', '2027-01', 2)).toBe('2027-02')
    expect(windowFor('2026-12-31', '2027-01', 2)).toBe('2026-12')
    expect(windowFor('2027-05-01', '2027-01', 1)).toBe('2027-05')
  })
})

describe('keyboard navigation', () => {
  const from = '2027-01-31' // a Sunday

  it('moves by day, week, month and year', () => {
    expect(navigateDate(from, 'ArrowLeft')).toBe('2027-01-30')
    expect(navigateDate(from, 'ArrowRight')).toBe('2027-02-01')
    expect(navigateDate(from, 'ArrowUp')).toBe('2027-01-24')
    expect(navigateDate(from, 'ArrowDown')).toBe('2027-02-07')
    expect(navigateDate(from, 'PageDown')).toBe('2027-02-28')
    expect(navigateDate(from, 'PageUp')).toBe('2026-12-31')
    expect(navigateDate('2028-02-29', 'PageDown', { shift: true })).toBe('2029-02-28')
    expect(navigateDate(from, 'PageUp', { shift: true })).toBe('2026-01-31')
  })

  it('jumps to the edges of the week for the configured week start', () => {
    expect(navigateDate(from, 'Home')).toBe('2027-01-25')
    expect(navigateDate(from, 'End')).toBe('2027-01-31')
    expect(navigateDate(from, 'Home', { weekStartsOn: 0 })).toBe('2027-01-31')
    expect(navigateDate(from, 'End', { weekStartsOn: 0 })).toBe('2027-02-06')
  })

  it('clamps into min/max and ignores other keys', () => {
    expect(navigateDate('2026-10-04', 'ArrowUp', { min: '2026-10-03' })).toBe('2026-10-03')
    expect(navigateDate('2027-04-29', 'PageDown', { max: '2027-04-30' })).toBe('2027-04-30')
    expect(navigateDate(from, 'Enter')).toBeNull()
    expect(navigateDate(from, 'a')).toBeNull()
  })
})

describe('range picking', () => {
  it('picks a start, then an end; tapping earlier restarts', () => {
    expect(pickRange({ start: null, end: null }, '2026-11-27')).toEqual({ start: '2026-11-27', end: null })
    expect(pickRange({ start: '2026-11-27', end: null }, '2026-11-29')).toEqual({ start: '2026-11-27', end: '2026-11-29' })
    expect(pickRange({ start: '2026-11-27', end: null }, '2026-11-27')).toEqual({ start: '2026-11-27', end: '2026-11-27' })
    expect(pickRange({ start: '2026-11-27', end: null }, '2026-11-20')).toEqual({ start: '2026-11-20', end: null })
    expect(pickRange({ start: '2026-11-27', end: '2026-11-29' }, '2026-12-02')).toEqual({ start: '2026-12-02', end: null })
  })

  it('restarts instead of exceeding maxDays', () => {
    expect(pickRange({ start: '2026-12-01', end: null }, '2026-12-14', { maxDays: 14 })).toEqual({ start: '2026-12-01', end: '2026-12-14' })
    expect(pickRange({ start: '2026-12-01', end: null }, '2026-12-15', { maxDays: 14 })).toEqual({ start: '2026-12-15', end: null })
  })

  it('previews the band while choosing the end', () => {
    expect(bandRange({ start: '2027-01-16', end: null }, '2027-01-18')).toEqual({ from: '2027-01-16', to: '2027-01-18', preview: true })
    expect(bandRange({ start: '2027-01-16', end: null }, '2027-01-10')).toBeNull()
    expect(bandRange({ start: '2027-01-16', end: '2027-01-17' }, '2027-01-30')).toEqual({ from: '2027-01-16', to: '2027-01-17', preview: false })
    expect(bandRange({ start: null, end: null }, '2027-01-30')).toBeNull()
  })

  it('draws the band per week row and counts nights', () => {
    const weeks = monthGrid('2026-11')
    const row = weeks.find((w) => w.includes('2026-11-27'))!
    expect(bandSegment(row, '2026-11-27', '2026-12-02')).toEqual({ c0: 4, c1: 6, startsHere: true, endsHere: false })
    expect(bandSegment(row, null, null)).toBeNull()
    expect(nightsLabel('2026-11-27', '2026-11-29')).toBe('2 nights · 3 days')
    expect(nightsLabel('2026-11-27', '2026-11-27')).toBe('Day trip · 1 day')
  })
})

describe('marks', () => {
  const marks = [
    { date: '2026-11-28', label: 'Opening day', tone: 'teal' as const },
    { date: '2026-12-01', to: '2027-04-30', label: 'Season window', variant: 'rule' as const },
    { date: '2027-02-14', label: 'Torchlight descent', tone: 'copper' as const },
  ]

  it('finds marks on a day, windows included', () => {
    expect(marksOn(marks, '2026-11-28').map((m) => m.label)).toEqual(['Opening day'])
    expect(marksOn(marks, '2027-02-14').map((m) => m.label)).toEqual(['Season window', 'Torchlight descent'])
    expect(marksOn(marks, '2026-11-29')).toEqual([])
    expect(marksOn(undefined, '2026-11-29')).toEqual([])
  })

  it('lists each visible mark once for the legend', () => {
    const nov = monthGrid('2026-11').flat().filter(Boolean) as string[]
    expect(legendFor(marks, nov).map((m) => m.label)).toEqual(['Opening day'])
    const decJan = [...monthGrid('2026-12').flat(), ...monthGrid('2027-01').flat()].filter(Boolean) as string[]
    expect(legendFor(marks, decJan).map((m) => m.label)).toEqual(['Season window'])
  })
})

describe('formatting', () => {
  it('formats single days without mm/dd/yyyy', () => {
    expect(formatDate('2027-01-16')).toBe('Sat 16 Jan 2027')
    expect(formatDate('2027-01-16', 'full')).toBe('Saturday 16 January 2027')
    expect(formatDate('2027-01-16', 'short')).toBe('Sat 16 Jan')
    expect(formatDate('2027-01-16', 'day-month')).toBe('16 Jan')
    expect(formatDate('', 'medium')).toBe('')
    expect(formatDate('16/01/2027')).toBe('')
    expect(formatMonth('2027-01')).toBe('January 2027')
  })

  it('writes ranges once', () => {
    expect(formatRange('2027-01-16', '2027-01-18')).toBe('Sat 16 – Mon 18 Jan 2027')
    expect(formatRange('2027-01-30', '2027-02-02')).toBe('Sat 30 Jan – Tue 2 Feb 2027')
    expect(formatRange('2026-12-31', '2027-01-02')).toBe('Thu 31 Dec 2026 – Sat 2 Jan 2027')
    expect(formatRange('2027-01-16', '2027-01-16')).toBe('Sat 16 Jan 2027')
    expect(formatRange('2027-01-16', null)).toBe('Sat 16 Jan 2027 – …')
    expect(formatRange('2027-01-16', '2027-01-18', { year: false })).toBe('Sat 16 – Mon 18 Jan')
    expect(formatRange(null, null)).toBe('')
  })

  it('describes days relative to the app clock', () => {
    const today = '2026-10-03'
    expect(relativeDay('2026-10-03', today)).toBe('Today')
    expect(relativeDay('2026-10-04', today)).toBe('Tomorrow')
    expect(relativeDay('2026-10-02', today)).toBe('Yesterday')
    expect(relativeDay('2026-10-08', today)).toBe('In 5 days')
    expect(relativeDay('2026-10-24', today)).toBe('In 3 weeks')
    expect(relativeDay('2027-01-16', today)).toBe('In 3 months')
    expect(relativeDay('2024-10-03', today)).toBe('2 years ago')
  })
})

describe('presets', () => {
  // 2026-10-03 is a Saturday, 2026-10-04 a Sunday, 2026-10-07 a Wednesday.
  it('finds this weekend and next from the passed today', () => {
    expect(weekendFrom('2026-10-07')).toEqual({ start: '2026-10-10', end: '2026-10-11' })
    expect(weekendFrom('2026-10-03')).toEqual({ start: '2026-10-03', end: '2026-10-04' })
    expect(weekendFrom('2026-10-04')).toEqual({ start: '2026-10-04', end: '2026-10-04' })
    expect(resolvePreset('next-weekend', '2026-10-07', 'range')).toMatchObject({ start: '2026-10-17', end: '2026-10-18' })
    expect(resolvePreset('next-weekend', '2026-10-04', 'range')).toMatchObject({ start: '2026-10-10', end: '2026-10-11' })
  })

  it('collapses range presets to their first day in single mode', () => {
    expect(resolvePreset('this-weekend', '2026-10-07', 'single')).toEqual({ key: 'this-weekend', label: 'This weekend', start: '2026-10-10', end: '2026-10-10' })
    expect(resolvePreset('tomorrow', '2026-10-07', 'single')).toMatchObject({ start: '2026-10-08', end: '2026-10-08' })
    expect(resolvePreset('next-7-days', '2026-10-07', 'single')).toBeNull()
    expect(resolvePreset('next-7-days', '2026-10-07', 'range')).toMatchObject({ start: '2026-10-07', end: '2026-10-13' })
  })

  it('accepts custom presets and drops ones that cannot be picked', () => {
    const list = ['today', 'tomorrow', 'this-weekend', { label: 'Opening day', date: '2026-11-28' }, { label: 'Bad', start: '2026-11-30', end: '2026-11-01' }] as const
    const got = resolvePresets(list, '2026-10-07', 'single', { min: '2026-10-08' })
    expect(got.map((p) => p.label)).toEqual(['Tomorrow', 'This weekend', 'Opening day'])
    const ranged = resolvePresets(['next-7-days', 'this-weekend'], '2026-10-07', 'range', {}, { maxDays: 3 })
    expect(ranged.map((p) => p.key)).toEqual(['this-weekend'])
    // 2026-10-03 is a Saturday: "This weekend" is the same day as "Today" in single mode, so it is dropped.
    expect(resolvePresets(['today', 'tomorrow', 'this-weekend'], '2026-10-03', 'single').map((p) => p.key)).toEqual(['today', 'tomorrow'])
    expect(resolvePresets(['this-weekend', 'next-7-days'], '2026-10-03', 'range').map((p) => p.key)).toEqual(['this-weekend', 'next-7-days'])
    const disabled = resolvePresets(['today'], '2026-10-07', 'single', { isDateDisabled: (d) => d === '2026-10-07' })
    expect(disabled).toEqual([])
  })
})
