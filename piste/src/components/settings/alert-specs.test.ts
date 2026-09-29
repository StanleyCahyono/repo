import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ALERT_TYPES } from '@/lib/db/schema'
import { RULE_PARAMS } from '@/lib/jobs/alerts'
import { DEFAULT_UNITS, type UnitPrefs } from '@/lib/domain/types'
import { ALERT_SPECS, ALERT_TYPE_ORDER, GLOBAL_ONLY_ALERTS, describeRule, snowFromInput, snowToInput } from './alert-specs'

const METRIC: UnitPrefs = { temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' }

describe('ALERT_SPECS mirror RULE_PARAMS (the jobs module stays the source of truth)', () => {
  it('covers every alert type exactly once, in the editor order', () => {
    expect([...ALERT_TYPE_ORDER].sort()).toEqual([...ALERT_TYPES].sort())
    expect(Object.keys(ALERT_SPECS).sort()).toEqual([...ALERT_TYPES].sort())
  })

  for (const type of ALERT_TYPES) {
    it(`${type}: defaults and ranges match the rule schema`, () => {
      const schema = RULE_PARAMS[type]
      const defaults = schema.parse({}) as Record<string, unknown>
      for (const p of ALERT_SPECS[type].params) {
        expect(defaults[p.key], `${type}.${p.key} default`).toBe(p.default)
        const step = Number.isInteger(p.min) && Number.isInteger(p.max) ? 1 : 0.1
        expect(schema.safeParse({ [p.key]: p.min }).success, `${p.key} = min`).toBe(true)
        expect(schema.safeParse({ [p.key]: p.max }).success, `${p.key} = max`).toBe(true)
        expect(schema.safeParse({ [p.key]: p.min - step }).success, `${p.key} < min`).toBe(false)
        expect(schema.safeParse({ [p.key]: p.max + step }).success, `${p.key} > max`).toBe(false)
      }
    })
  }

  it('only pass deadlines are global-only (every product, no resort)', () => {
    expect(GLOBAL_ONLY_ALERTS).toEqual(['pass-deadline'])
  })
})

describe('snow thresholds: typed in display units, stored in cm', () => {
  it('converts inches to cm on the way in and back for editing', () => {
    const imperial = DEFAULT_UNITS
    expect(snowFromInput(6, imperial)).toBe(15.2)
    expect(snowToInput(15.2, imperial)).toBe(6)
    expect(snowFromInput(15, METRIC)).toBe(15)
    expect(snowToInput(15, METRIC)).toBe(15)
  })

  it('describes the same stored rule in either unit system without changing it', () => {
    const params = { thresholdCm: 15, windowHours: 72 }
    expect(describeRule('snow-threshold', params, DEFAULT_UNITS)).toBe('Likely 5.9″ or more within 72 h')
    expect(describeRule('snow-threshold', params, METRIC)).toBe('Likely 15 cm or more within 72 h')
    expect(params).toEqual({ thresholdCm: 15, windowHours: 72 })
  })

  it('falls back to defaults for missing or damaged parameters', () => {
    expect(describeRule('pass-deadline', {}, METRIC)).toBe('Deadlines within 14 days')
    expect(describeRule('forecast-deterioration', { minDrop: 'lots', mode: 'bogus' }, METRIC)).toBe('Score falls 15 points or more · your default lens')
  })
})
