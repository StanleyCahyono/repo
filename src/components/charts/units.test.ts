import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS, type UnitPrefs } from '@/lib/domain/types'
import { chartUnits, minus } from './units'

const imperial = chartUnits(DEFAULT_UNITS)
const metric = chartUnits({ temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' } satisfies UnitPrefs)

describe('chartUnits', () => {
  it('keeps unknown unknown — null in, null out, never 0', () => {
    for (const q of [...Object.values(imperial), ...Object.values(metric)]) {
      expect(q.toDisplay(null)).toBeNull()
      expect(q.format(null)).toBeNull()
      expect(q.short(undefined)).toBeNull()
    }
  })

  it('converts canonical metric to the preferred display units', () => {
    expect(imperial.snow.toDisplay(2.54)).toBeCloseTo(1)
    expect(imperial.snow.format(10.16)).toBe('4″')
    expect(metric.snow.format(4)).toBe('4 cm')
    expect(imperial.temp.format(-10)).toBe('14°F')
    expect(metric.temp.format(-6.4)).toBe('−6°C')
    expect(imperial.speed.format(40)).toBe('25 mph')
    expect(metric.elevation.format(2600)).toBe('2,600 m')
    expect(imperial.elevation.short(2600)).toBe('8,530')
    expect(imperial.precip.format(2.54)).toBe('0.1 in')
  })

  it('shows a trace as "<0.1" rather than rounding it to zero', () => {
    expect(imperial.snow.format(0.1)).toBe('<0.1″')
    expect(metric.snow.short(0.02)).toBe('<0.1')
    expect(imperial.snow.format(0)).toBe('0″')
  })

  it('caps visibility where models stop resolving it', () => {
    expect(metric.visibility.format(24_000)).toBe('16+ km')
    expect(imperial.visibility.short(30_000)).toBe('10+')
    expect(metric.visibility.format(800)).toBe('0.8 km')
  })

  it('uses a typographic minus', () => {
    expect(minus('-6°')).toBe('−6°')
    expect(minus('from -3 to -1')).toBe('from −3 to −1')
    expect(metric.temp.tick(-10)).toBe('−10°')
  })
})
