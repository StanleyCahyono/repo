import { describe, expect, it } from 'vitest'
import { angleDelta, bearingDeg, cumulativeKm, driveEffort, greatCircleArc, haversineKm, leaveBy, legDurationMs, pathKm, pointAlong, type LonLat } from './journey'

const ITH: LonLat = [-76.4584, 42.491]
const GVA: LonLat = [6.109, 46.2381]
const CTS: LonLat = [141.6923, 42.7752]

describe('greatCircleArc', () => {
  it('starts and ends at the endpoints', () => {
    const arc = greatCircleArc(ITH, GVA, 64)
    expect(arc).toHaveLength(65)
    expect(arc[0][0]).toBeCloseTo(ITH[0], 6)
    expect(arc[0][1]).toBeCloseTo(ITH[1], 6)
    expect(arc[64][0]).toBeCloseTo(GVA[0], 4)
    expect(arc[64][1]).toBeCloseTo(GVA[1], 6)
  })

  it('bows towards the pole on a transatlantic arc', () => {
    const arc = greatCircleArc(ITH, GVA, 64)
    const maxLat = Math.max(...arc.map((p) => p[1]))
    expect(maxLat).toBeGreaterThan(50)
  })

  it('is about as long as the haversine distance', () => {
    const arc = greatCircleArc(ITH, GVA, 128)
    expect(pathKm(arc)).toBeCloseTo(haversineKm(ITH, GVA), -1)
  })

  it('keeps longitudes continuous across the antimeridian', () => {
    const arc = greatCircleArc(ITH, CTS, 128)
    for (let i = 1; i < arc.length; i++) expect(Math.abs(arc[i][0] - arc[i - 1][0])).toBeLessThan(180)
    // Ithaca → Sapporo goes west over Alaska, so the end longitude is unwrapped past −180.
    expect(arc[arc.length - 1][0]).toBeCloseTo(CTS[0] - 360, 3)
  })

  it('handles identical endpoints', () => {
    expect(greatCircleArc(ITH, ITH)).toEqual([ITH, ITH])
  })
})

describe('pointAlong', () => {
  const line: LonLat[] = [
    [0, 0],
    [1, 0],
    [2, 0],
  ]
  const cum = cumulativeKm(line)
  it('returns the ends at 0 and 1', () => {
    expect(pointAlong(line, cum, 0).point).toEqual([0, 0])
    expect(pointAlong(line, cum, 1).point[0]).toBeCloseTo(2, 6)
  })
  it('interpolates by distance', () => {
    const mid = pointAlong(line, cum, 0.5)
    expect(mid.point[0]).toBeCloseTo(1, 3)
    const q = pointAlong(line, cum, 0.25)
    expect(q.point[0]).toBeCloseTo(0.5, 3)
    expect(q.index).toBe(1)
  })
  it('clamps out-of-range fractions', () => {
    expect(pointAlong(line, cum, -1).point).toEqual([0, 0])
    expect(pointAlong(line, cum, 2).point[0]).toBeCloseTo(2, 6)
  })
})

describe('bearings', () => {
  it('points east and north', () => {
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 3)
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 3)
  })
  it('takes the short way round', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
  })
})

describe('leaveBy', () => {
  it('subtracts the drive from the first lift in the resort zone', () => {
    const r = leaveBy({ date: '2027-01-16', firstLift: '08:30', resortTz: 'America/New_York', homeTz: 'America/New_York', driveMinutes: 40 })
    expect(r?.leaveLocal).toBe('07:50')
    expect(r?.leaveDate).toBe('2027-01-16')
    expect(r?.firstLiftAt).toBe('2027-01-16T13:30:00.000Z')
  })
  it('converts to the home zone and can fall on the previous day', () => {
    const r = leaveBy({ date: '2027-01-16', firstLift: '08:30', resortTz: 'America/Denver', homeTz: 'America/New_York', driveMinutes: 600 })
    // 08:30 MST = 10:30 EST; minus 10 h = 00:30 EST the same day.
    expect(r?.leaveLocal).toBe('00:30')
    const r2 = leaveBy({ date: '2027-01-16', firstLift: '08:30', resortTz: 'America/New_York', homeTz: 'America/New_York', driveMinutes: 540 })
    expect(r2?.leaveLocal).toBe('23:30')
    expect(r2?.leaveDate).toBe('2027-01-15')
  })
  it('handles the DST change', () => {
    const r = leaveBy({ date: '2027-03-14', firstLift: '08:30', resortTz: 'America/New_York', homeTz: 'America/New_York', driveMinutes: 420 })
    // 08:30 EDT minus 7 h crosses 02:00 → 00:30 EST.
    expect(r?.leaveLocal).toBe('00:30')
  })
  it('rejects unusable inputs', () => {
    expect(leaveBy({ date: '2027-01-16', firstLift: '8.30', resortTz: 'America/New_York', homeTz: 'America/New_York', driveMinutes: 40 })).toBeNull()
    expect(leaveBy({ date: '2027-01-16', firstLift: '08:30', resortTz: 'America/New_York', homeTz: 'America/New_York', driveMinutes: -5 })).toBeNull()
  })
})

describe('effort and timing', () => {
  it('labels drive effort from minutes, unknown stays null', () => {
    expect(driveEffort(40)).toBe('low')
    expect(driveEffort(150)).toBe('moderate')
    expect(driveEffort(320)).toBe('high')
    expect(driveEffort(600)).toBe('very-high')
    expect(driveEffort(null)).toBeNull()
  })
  it('keeps animations within bounds', () => {
    expect(legDurationMs('air', 20000)).toBe(9500)
    expect(legDurationMs('drive', 1)).toBe(3600)
    expect(legDurationMs('ground', 10)).toBe(1800)
  })
})
