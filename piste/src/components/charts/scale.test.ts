import { describe, expect, it } from 'vitest'
import {
  anyKnown,
  clampIndex,
  dayMarks,
  extentKnown,
  hourInterval,
  hourTicks,
  HOUR_MS,
  labelWidth,
  nearestIndex,
  placeDayLabels,
  placeTickLabels,
  runsOf,
  sumKnown,
  tickStep,
  valueDomain,
  type LocalStamp,
} from './scale'

const T0 = Date.parse('2027-01-15T14:00:00.000Z')
/** Hourly stamps for Denver (UTC−7) starting 07:00 local on 15 Jan. */
const stamps: LocalStamp[] = Array.from({ length: 30 }, (_, i) => {
  const localHour = (7 + i) % 24
  const day = 15 + Math.floor((7 + i) / 24)
  return { t: T0 + i * HOUR_MS, localDate: `2027-01-${day}`, localTime: `${String(localHour).padStart(2, '0')}:00` }
})

describe('tickStep', () => {
  it('picks the smallest step that keeps labels apart', () => {
    expect(tickStep(960, 48)).toBe(3) // 20 px/h → 3 h = 60 px
    expect(tickStep(300, 48)).toBe(12) // 6.25 px/h → 6 h = 37.5 px is too tight
    expect(tickStep(2400, 48)).toBe(1)
  })
  it('falls back to the largest step for degenerate input', () => {
    expect(tickStep(0, 48)).toBe(24)
    expect(tickStep(500, 0)).toBe(24)
  })
})

describe('hourTicks / dayMarks', () => {
  it('ticks on resort-local multiples of the step, midnights major', () => {
    const ticks = hourTicks(stamps, 6)
    expect(ticks.map((t) => t.label)).toEqual(['12:00', '18:00', '00:00', '06:00', '12:00'])
    expect(ticks.find((t) => t.label === '00:00')?.major).toBe(true)
  })
  it('marks each new local day after the first', () => {
    const marks = dayMarks(stamps, (d) => `day ${d.slice(8)}`)
    expect(marks).toEqual([{ t: T0 + 17 * HOUR_MS, date: '2027-01-16', label: 'day 16' }])
  })
})

describe('nearestIndex / clampIndex', () => {
  const ts = [0, 10, 20, 30]
  it('finds the nearest value, ties to the earlier one', () => {
    expect(nearestIndex(ts, -5)).toBe(0)
    expect(nearestIndex(ts, 14)).toBe(1)
    expect(nearestIndex(ts, 15)).toBe(1)
    expect(nearestIndex(ts, 16)).toBe(2)
    expect(nearestIndex(ts, 99)).toBe(3)
    expect(nearestIndex([], 5)).toBe(-1)
  })
  it('clamps into range and keeps null', () => {
    expect(clampIndex(-3, 4)).toBe(0)
    expect(clampIndex(9, 4)).toBe(3)
    expect(clampIndex(null, 4)).toBeNull()
    expect(clampIndex(2, 0)).toBeNull()
  })
})

describe('hourInterval', () => {
  it('follows the provider interval semantics', () => {
    expect(hourInterval(T0, 'preceding-hour')).toEqual([T0 - HOUR_MS, T0])
    expect(hourInterval(T0, 'following-hour')).toEqual([T0, T0 + HOUR_MS])
    expect(hourInterval(T0, 'instant')).toEqual([T0 - HOUR_MS / 2, T0 + HOUR_MS / 2])
  })
})

describe('valueDomain', () => {
  it('ignores unknown values instead of treating them as zero', () => {
    expect(valueDomain([null, -8, -2, null], {})).toEqual([-8, -2])
    expect(valueDomain([null, undefined])).toBeNull()
  })
  it('includes zero and a readable floor for accumulations', () => {
    expect(valueDomain([0, 0.05, null], { includeZero: true, floorMax: 0.4 })).toEqual([0, 0.4])
  })
  it('widens flat series to a minimum span and honours reference lines', () => {
    const [lo, hi] = valueDomain([20, 20], { minSpan: 12 })!
    expect(hi - lo).toBeGreaterThanOrEqual(12)
    expect(valueDomain([10, 12], { extra: [32] })![1]).toBeGreaterThanOrEqual(32)
  })
  it('clamps capped quantities', () => {
    expect(valueDomain([4, 30], { includeZero: true, clampMax: 16 })).toEqual([0, 16])
  })
})

describe('runsOf', () => {
  it('merges contiguous matching items into ranges', () => {
    const items = [true, true, false, true].map((night, i) => ({ night, t: i * 10 }))
    expect(
      runsOf(
        items,
        (x) => x.night,
        (x) => [x.t, x.t + 10],
      ),
    ).toEqual([
      { from: 0, to: 20 },
      { from: 30, to: 40 },
    ])
  })
})

describe('sumKnown / extentKnown / anyKnown', () => {
  it('sums known values only and reports completeness', () => {
    expect(sumKnown([1, null, 2])).toEqual({ sum: 3, known: 2, total: 3, complete: false })
    expect(sumKnown([0, 0])).toEqual({ sum: 0, known: 2, total: 2, complete: true })
    expect(sumKnown([null]).sum).toBeNull()
    expect(extentKnown([null, 3, -1])).toEqual([-1, 3])
    expect(extentKnown([null])).toBeNull()
    expect(anyKnown([null, undefined])).toBe(false)
  })
})

describe('axis label placement', () => {
  it('keeps edge labels inside the plot and hides labels that would collide', () => {
    const w = labelWidth('09:00')
    const slots = placeTickLabels([46, 60, 120, 400], ['09:00', '10:00', '12:00', '21:00'], 46, 400)
    expect(slots[0]).toMatchObject({ anchor: 'start', show: true })
    expect(slots[1].show).toBe(false) // would overlap 09:00
    expect(slots[2].show).toBe(46 + w + 6 <= 120 - w / 2)
    expect(slots[3]).toMatchObject({ anchor: 'end', show: true })
  })
  it('gives way on a short partial first day rather than a full day', () => {
    const slots = placeDayLabels([46, 70, 300], ['Fri 15', 'Sat 16', 'Sun 17'], 46, 400)
    expect(slots.map((s) => s.show)).toEqual([false, true, true])
    expect(slots[1].x).toBe(73)
  })
})
