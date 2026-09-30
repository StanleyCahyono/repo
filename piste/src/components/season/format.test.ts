import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { money } from '@/lib/domain/money'
import { timelineWindow } from '@/lib/data/season-screen'
import { crowdText, hoursText, majorString, rangeLabel } from './format'

describe('season format helpers', () => {
  it('drops a trailing "my guess" for display (the label already says so) but keeps the rest verbatim', () => {
    expect(crowdText('Moderate — my guess')).toBe('Moderate')
    expect(crowdText('Busy — holiday week, my guess')).toBe('Busy — holiday week')
    expect(crowdText('Quiet')).toBe('Quiet')
    expect(crowdText(null)).toBeNull()
  })

  it('formats hours and money for forms without inventing values', () => {
    expect(hoursText(3.5)).toBe('3 h 30 min')
    expect(hoursText(0.75)).toBe('45 min')
    expect(hoursText(null)).toBeNull()
    expect(majorString(money(6450, 'USD'))).toBe('64.50')
    expect(majorString(money(5900, 'USD'))).toBe('59')
    expect(majorString(null)).toBe('')
    expect(rangeLabel('2027-02-13', '2027-02-17')).toBe('13–17 Feb')
  })

  it('draws the season from 1 Nov to 30 Apr, widened to whole months for anything outside it', () => {
    expect(timelineWindow('2026-27', ['2027-01-10'])).toEqual({ from: '2026-11-01', to: '2027-04-30' })
    expect(timelineWindow('2026-27', ['2026-10-24', '2027-05-09', '2025-12-01'])).toEqual({ from: '2026-10-01', to: '2027-05-31' })
  })

  it('draws a Southern Hemisphere winter in the season: May–October at a southern home, and a northern season widened to it', () => {
    expect(timelineWindow('2026-27', [], { home: 'south' })).toEqual({ from: '2027-05-01', to: '2027-10-31' })
    // A 2026-27 trip to New Zealand in August 2027 widens a northern season through August…
    expect(timelineWindow('2026-27', ['2027-01-10', '2027-08-12'], { southern: true })).toEqual({ from: '2026-11-01', to: '2027-08-31' })
    // …but only when a southern day is in view: without it, August 2027 is next season (2027-28) and is ignored.
    expect(timelineWindow('2026-27', ['2027-01-10', '2027-08-12'])).toEqual({ from: '2026-11-01', to: '2027-04-30' })
  })
})
