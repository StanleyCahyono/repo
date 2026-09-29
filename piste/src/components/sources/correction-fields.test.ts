import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { ResortRow, ResortSeasonRow } from '@/lib/db/rows'
import { applyOverrides } from '@/lib/data/core'
import { buildFixture } from '@/lib/data/fixtures.test-helpers'
import { DEFAULT_UNITS, type UnitPrefs } from '@/lib/domain/types'
import { CORRECTION_FIELDS, formatCorrectionValue, nullable, parseCorrectionValue, toInputValue, type FieldKind } from './correction-fields'

const METRIC: UnitPrefs = { temperature: 'C', snow: 'cm', distance: 'km', elevation: 'm', speed: 'kmh' }

/** A valid typed value per kind. */
const SAMPLE: Record<FieldKind, string> = {
  text: 'Corrected name',
  'text?': 'Some text',
  'longtext?': 'A longer note about the resort.',
  'int?': '42',
  'number?': '1234.5',
  'pct?': '37.5',
  'elevation?': '3000',
  lat: '42.51',
  lon: '-76.12',
  'bool?': 'yes',
  'date?': '2026-12-05',
  'url?': 'https://example.org/page',
  tz: 'America/Denver',
}

let resort: ResortRow
let season: ResortSeasonRow

beforeAll(async () => {
  const { db } = await buildFixture()
  ;[resort] = await db.select().from(s.resorts).where(eq(s.resorts.id, 'test-peak'))
  ;[season] = await db
    .select()
    .from(s.resortSeasons)
    .where(and(eq(s.resortSeasons.resortId, 'test-peak'), eq(s.resortSeasons.seasonId, '2026-27')))
})

const apply = (field: string, value: unknown) => applyOverrides(resort, season, [{ id: 1, resortId: resort.id, field, value, note: 'test', sourceUrl: null, createdAt: '2027-01-15T12:00:00.000Z' }])

describe('every correctable field is one applyOverrides accepts', () => {
  for (const f of CORRECTION_FIELDS) {
    it(`${f.field} (${f.kind})`, () => {
      const parsed = parseCorrectionValue(f.kind, SAMPLE[f.kind], 'm')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const { corrections } = apply(f.field, parsed.value)
      expect(corrections[0], f.field).toMatchObject({ applied: true, reason: null })
      if (nullable(f.kind)) expect(apply(f.field, null).corrections[0].applied, `${f.field} = unknown`).toBe(true)
    })
  }
})

describe('parseCorrectionValue', () => {
  it('stores elevations in metres whatever unit they were typed in', () => {
    expect(parseCorrectionValue('elevation?', '10,551', 'ft')).toEqual({ ok: true, value: 3215.9 })
    expect(parseCorrectionValue('elevation?', '3216', 'm')).toEqual({ ok: true, value: 3216 })
    expect(parseCorrectionValue('elevation?', '40000', 'ft')).toMatchObject({ ok: false })
  })

  it('keeps unknown distinct from "no" and from zero', () => {
    expect(parseCorrectionValue('bool?', 'no')).toEqual({ ok: true, value: false })
    expect(parseCorrectionValue('bool?', 'unknown')).toEqual({ ok: true, value: null })
    expect(parseCorrectionValue('int?', '')).toEqual({ ok: true, value: null })
    expect(parseCorrectionValue('int?', '0')).toEqual({ ok: true, value: 0 })
    expect(parseCorrectionValue('text', '')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('lat', null)).toMatchObject({ ok: false })
  })

  it('refuses malformed values', () => {
    expect(parseCorrectionValue('date?', '2026-02-30')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('date?', '5 Dec')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('url?', 'javascript:alert(1)')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('url?', 'example.org')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('pct?', '120')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('int?', '2.5')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('tz', 'Mountain Time')).toMatchObject({ ok: false })
    expect(parseCorrectionValue('lon', '-190')).toMatchObject({ ok: false })
  })
})

describe('display and editing', () => {
  it('shows elevations in the display unit and says what is stored', () => {
    expect(formatCorrectionValue('elevation?', 3216, DEFAULT_UNITS)).toBe('10,551 ft (3,216 m stored)')
    expect(formatCorrectionValue('elevation?', 3216, METRIC)).toBe('3,216 m')
    expect(toInputValue('elevation?', 3216, 'ft')).toBe('10551')
  })

  it('labels unknown values instead of printing blanks or zero', () => {
    expect(formatCorrectionValue('int?', null, METRIC)).toBe('Unknown / not set')
    expect(formatCorrectionValue('bool?', null, METRIC)).toBe('Unknown')
    expect(formatCorrectionValue('bool?', false, METRIC)).toBe('No — not offered')
    expect(formatCorrectionValue('date?', '2026-12-05', METRIC)).toBe('Sat 5 Dec 2026')
  })
})
