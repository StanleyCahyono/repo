import { describe, expect, it } from 'vitest'
import { categoryTotals, doorToDoor, itineraryTiming } from './model'

const zones = { SYR: 'America/New_York', ORD: 'America/Chicago', SLC: 'America/Denver' }

describe('itineraryTiming', () => {
  it('times a connecting itinerary across time zones from first departure to final arrival', () => {
    const t = itineraryTiming(
      [
        { carrier: 'XX', flightNumber: '1', from: 'SYR', to: 'ORD', departLocal: '2027-02-13T06:00', arriveLocal: '2027-02-13T07:25' },
        { carrier: 'XX', flightNumber: '2', from: 'ORD', to: 'SLC', departLocal: '2027-02-13T09:00', arriveLocal: '2027-02-13T11:40' },
      ],
      zones,
    )
    // 06:00 EST = 11:00Z; 11:40 MST = 18:40Z → 7 h 40 min.
    expect(t.totalMinutes).toBe(460)
    expect(t.connections).toBe(1)
    expect(t.layovers).toEqual([{ at: 'ORD', minutes: 95, overnight: false }])
    expect(t.issues).toEqual([])
  })

  it('leaves the duration unknown when an end airport has no known zone (never guesses an offset)', () => {
    const t = itineraryTiming([{ from: 'SYR', to: 'XYZ', departLocal: '2027-02-13T06:00', arriveLocal: '2027-02-13T09:00' }], zones)
    expect(t.totalMinutes).toBeNull()
    expect(t.issues[0]).toMatch(/Time zone not on file for XYZ/)
  })

  it('flags an overnight connection and missing times', () => {
    const t = itineraryTiming(
      [
        { from: 'SYR', to: 'ORD', departLocal: '2027-02-12T20:00', arriveLocal: '2027-02-12T21:30' },
        { from: 'ORD', to: 'SLC', departLocal: '2027-02-13T07:00', arriveLocal: '2027-02-13T09:40' },
      ],
      zones,
    )
    expect(t.layovers[0]).toMatchObject({ overnight: true, minutes: 570 })
    expect(itineraryTiming([{ from: 'SYR', to: 'SLC' }], zones).issues[0]).toMatch(/Add the first departure/)
    expect(itineraryTiming([], zones).totalMinutes).toBeNull()
  })
})

describe('doorToDoor', () => {
  const base = { originIata: 'SYR', homeName: 'Ithaca', driveToAirport: 70, airportBuffer: 90, arrivalBuffer: 45, destinationIata: 'SLC', resortName: 'Alta', transferMinutes: 50, winterPct: 20 }
  it('adds the explicit winter buffer to ground legs only and totals when every leg is known', () => {
    const d = doorToDoor({ ...base, flightMinutes: 460 })
    expect(d.legs.map((l) => l.minutes)).toEqual([84, 90, 460, 45, 60])
    expect(d.total).toBe(84 + 90 + 460 + 45 + 60)
    expect(d.unknown).toEqual([])
  })
  it('never totals with an unknown flight leg', () => {
    const d = doorToDoor({ ...base, flightMinutes: null })
    expect(d.total).toBeNull()
    expect(d.known).toBe(84 + 90 + 45 + 60)
    expect(d.unknown).toEqual(['Flights SYR → SLC'])
  })
})

describe('categoryTotals', () => {
  it('sums priced lines by category and ignores unpriced ones', () => {
    const m = (n: number) => ({ amountMinor: n })
    const out = categoryTotals(
      [
        { type: 'flight', groupTotal: { min: m(100), max: m(200) } },
        { type: 'drive', groupTotal: { min: m(10), max: m(10) } },
        { type: 'lesson', groupTotal: null },
      ],
      (t) => (t === 'lesson' ? 'lessons' : 'travel'),
      ['travel', 'lessons'] as const,
    )
    expect(out).toEqual([{ key: 'travel', lines: 2, min: 110, max: 210 }])
  })
})
