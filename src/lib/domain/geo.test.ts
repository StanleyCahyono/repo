import { describe, expect, it } from 'vitest'
import { greatCircleKm, isLongHaul, LONG_HAUL_KM } from './geo'

const ithaca = { lat: 42.4406, lon: -76.4966 }
const sydney = { lat: -33.8688, lon: 151.2093 }

describe('great-circle distance and the long-haul rule', () => {
  it('measures straight-line distance in km', () => {
    expect(greatCircleKm(ithaca, ithaca)).toBe(0)
    // Ithaca → Greek Peak ≈ 30 km; Ithaca → Alta ≈ 2,910 km.
    expect(greatCircleKm(ithaca, { lat: 42.5086, lon: -76.146 })).toBeGreaterThan(28)
    expect(greatCircleKm(ithaca, { lat: 42.5086, lon: -76.146 })).toBeLessThan(32)
    const alta = greatCircleKm(ithaca, { lat: 40.5885, lon: -111.638 })
    expect(alta).toBeGreaterThan(2900)
    expect(alta).toBeLessThan(3050)
  })

  it('keeps North America in reach of Ithaca and plans Europe, Japan and Australasia as trips', () => {
    expect(LONG_HAUL_KM).toBe(4500)
    expect(isLongHaul(ithaca, { lat: 40.5885, lon: -111.638 })).toBe(false) // Alta
    expect(isLongHaul(ithaca, { lat: 50.115, lon: -122.95 })).toBe(false) // Whistler ≈ 3,600 km
    expect(isLongHaul(ithaca, { lat: 47.129, lon: 10.264 })).toBe(true) // Ski Arlberg ≈ 6,500 km
    expect(isLongHaul(ithaca, { lat: 42.86, lon: 140.7 })).toBe(true) // Niseko ≈ 9,800 km
    expect(isLongHaul(ithaca, { lat: -36.5048, lon: 148.3 })).toBe(true) // Thredbo
  })

  it('works from a Southern Hemisphere home too', () => {
    expect(isLongHaul(sydney, { lat: -36.5048, lon: 148.3 })).toBe(false) // Thredbo ≈ 390 km
    expect(isLongHaul(sydney, { lat: -44.924, lon: 168.73 })).toBe(false) // Coronet Peak ≈ 1,900 km
    expect(isLongHaul(sydney, { lat: 42.86, lon: 140.7 })).toBe(true) // Niseko ≈ 8,600 km
  })

  it('never hides a resort on a guess: unknown coordinates are not long haul', () => {
    expect(isLongHaul(ithaca, { lat: Number.NaN, lon: 0 })).toBe(false)
    expect(isLongHaul(null, { lat: 47, lon: 10 })).toBe(false)
    expect(isLongHaul(ithaca, undefined)).toBe(false)
  })
})
