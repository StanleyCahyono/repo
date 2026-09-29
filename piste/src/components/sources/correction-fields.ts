/**
 * The catalog fields you can correct by hand (resort_overrides), how each is entered, parsed and shown.
 *
 * Pure module (no React, no server imports): the correction form, the corrections list and the server action that
 * validates input all use it. Stored values follow the app's rules — metric (elevations in metres), dates as
 * YYYY-MM-DD, `null` = unknown — and `applyOverrides` (src/lib/data/core.ts) validates them again on every read.
 * correction-fields.test.ts checks that every field listed here is one applyOverrides accepts.
 */
import { DateTime } from 'luxon'
import { ftToM, formatElevation } from '@/lib/domain/units'
import type { UnitPrefs } from '@/lib/domain/types'

export type FieldKind = 'text' | 'text?' | 'longtext?' | 'int?' | 'number?' | 'pct?' | 'elevation?' | 'lat' | 'lon' | 'bool?' | 'date?' | 'url?' | 'tz'

export const CORRECTION_GROUPS = [
  { id: 'identity', label: 'Name & location' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'features', label: 'Lessons, rentals & features' },
  { id: 'season', label: 'This season' },
  { id: 'links', label: 'Official links' },
  { id: 'about', label: 'Description' },
] as const
export type CorrectionGroup = (typeof CORRECTION_GROUPS)[number]['id']

export interface CorrectionField {
  field: string
  label: string
  group: CorrectionGroup
  kind: FieldKind
  hint?: string
}

const link = (key: string, label: string): CorrectionField => ({ field: `links.${key}`, label, group: 'links', kind: 'url?' })

export const CORRECTION_FIELDS: readonly CorrectionField[] = [
  { field: 'name', label: 'Name', group: 'identity', kind: 'text' },
  { field: 'shortName', label: 'Short name', group: 'identity', kind: 'text' },
  { field: 'region', label: 'Region', group: 'identity', kind: 'text' },
  { field: 'stateProvince', label: 'State / province', group: 'identity', kind: 'text?' },
  { field: 'locality', label: 'Town', group: 'identity', kind: 'text?' },
  { field: 'operator', label: 'Operator', group: 'identity', kind: 'text?' },
  { field: 'timezone', label: 'Time zone', group: 'identity', kind: 'tz', hint: 'Resort days and opening hours use this zone.' },
  { field: 'lat', label: 'Latitude', group: 'identity', kind: 'lat', hint: 'Decimal degrees, north positive.' },
  { field: 'lon', label: 'Longitude', group: 'identity', kind: 'lon', hint: 'Decimal degrees, east positive (west is negative).' },
  { field: 'baseElevationM', label: 'Base elevation', group: 'elevation', kind: 'elevation?' },
  { field: 'summitElevationM', label: 'Summit elevation', group: 'elevation', kind: 'elevation?' },
  { field: 'verticalM', label: 'Vertical drop', group: 'elevation', kind: 'elevation?' },
  { field: 'terrain.trails', label: 'Trails', group: 'terrain', kind: 'int?' },
  { field: 'terrain.lifts', label: 'Lifts', group: 'terrain', kind: 'int?' },
  { field: 'terrain.skiableAcres', label: 'Skiable acres', group: 'terrain', kind: 'number?' },
  { field: 'terrain.beginnerPct', label: 'Beginner terrain', group: 'terrain', kind: 'pct?' },
  { field: 'terrain.intermediatePct', label: 'Intermediate terrain', group: 'terrain', kind: 'pct?' },
  { field: 'terrain.advancedPct', label: 'Advanced terrain', group: 'terrain', kind: 'pct?' },
  { field: 'terrain.terrainParks', label: 'Terrain parks', group: 'terrain', kind: 'int?' },
  { field: 'features.lessons', label: 'Lessons', group: 'features', kind: 'bool?' },
  { field: 'features.rentals', label: 'Rentals', group: 'features', kind: 'bool?' },
  { field: 'features.nightSkiing', label: 'Night skiing', group: 'features', kind: 'bool?' },
  { field: 'features.beginnerArea', label: 'Beginner area', group: 'features', kind: 'text?', hint: 'Where first-timers start, e.g. a carpet or a named lift.' },
  { field: 'features.snowmakingPct', label: 'Snowmaking coverage', group: 'features', kind: 'pct?' },
  { field: 'features.onMountainLodging', label: 'On-mountain lodging', group: 'features', kind: 'bool?' },
  { field: 'features.tubing', label: 'Tubing', group: 'features', kind: 'bool?' },
  { field: 'features.childcare', label: 'Childcare', group: 'features', kind: 'bool?' },
  { field: 'season.announcedOpening', label: 'Announced opening date', group: 'season', kind: 'date?', hint: 'A target date. It never turns into “Open” by itself.' },
  { field: 'season.announcedOpeningText', label: 'Opening announcement wording', group: 'season', kind: 'text?' },
  { field: 'season.announcedClosing', label: 'Announced closing date', group: 'season', kind: 'date?' },
  { field: 'season.announcedClosingText', label: 'Closing announcement wording', group: 'season', kind: 'text?' },
  { field: 'season.actualOpening', label: 'Actual opening date', group: 'season', kind: 'date?', hint: 'Only once the resort has actually opened.' },
  { field: 'season.actualClosing', label: 'Actual closing date', group: 'season', kind: 'date?' },
  { field: 'season.typicalOpeningText', label: 'Typical opening (wording)', group: 'season', kind: 'text?' },
  { field: 'season.notes', label: 'Season notes', group: 'season', kind: 'longtext?' },
  link('official', 'Official website'),
  link('snowReport', 'Snow report'),
  link('trailMap', 'Trail map'),
  link('interactiveMap', 'Interactive map'),
  link('hours', 'Hours'),
  link('tickets', 'Lift tickets'),
  link('seasonPass', 'Season pass'),
  link('lessons', 'Lessons'),
  link('rentals', 'Rentals'),
  link('webcams', 'Webcams'),
  link('parking', 'Parking'),
  link('roadInfo', 'Road conditions'),
  link('lodging', 'Lodging'),
  link('events', 'Events'),
  link('tourism', 'Tourism office'),
  link('avalanche', 'Avalanche centre'),
  link('openSkiMap', 'OpenSkiMap'),
  { field: 'character', label: 'Character', group: 'about', kind: 'longtext?' },
  { field: 'learning', label: 'Learning notes', group: 'about', kind: 'longtext?' },
]

const BY_FIELD = new Map(CORRECTION_FIELDS.map((f) => [f.field, f]))

export function correctionField(field: string): CorrectionField | null {
  return BY_FIELD.get(field) ?? null
}

export function fieldLabel(field: string): string {
  return BY_FIELD.get(field)?.label ?? field
}

/** Can this field be set to "unknown" (null)? */
export const nullable = (kind: FieldKind) => kind.endsWith('?')

// ---------------------------------------------------------------------------
// Parsing (form text → stored value)

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

const isZone = (v: string) => DateTime.local().setZone(v).isValid

/**
 * Parse what was typed into the stored value. `raw === null` means "set to unknown" (only for nullable kinds).
 * Elevations are typed in `unit` and stored in metres (one decimal).
 */
export function parseCorrectionValue(kind: FieldKind, raw: string | null, unit: 'ft' | 'm' = 'm'): ParseResult {
  if (raw === null) return nullable(kind) ? { ok: true, value: null } : { ok: false, error: 'This field cannot be unknown' }
  const s = raw.trim()
  if (!s) return nullable(kind) ? { ok: true, value: null } : { ok: false, error: 'Enter a value' }
  const num = Number(s.replace(/,/g, ''))
  switch (kind) {
    case 'text':
    case 'text?':
      return s.length > 200 ? { ok: false, error: 'Keep it under 200 characters' } : { ok: true, value: s }
    case 'longtext?':
      return s.length > 2000 ? { ok: false, error: 'Keep it under 2,000 characters' } : { ok: true, value: s }
    case 'int?':
      return Number.isInteger(num) && num >= 0 && num <= 100_000 ? { ok: true, value: num } : { ok: false, error: 'Enter a whole number (0 or more)' }
    case 'number?':
      return Number.isFinite(num) && num >= 0 && num <= 1_000_000 ? { ok: true, value: num } : { ok: false, error: 'Enter a number (0 or more)' }
    case 'pct?':
      return Number.isFinite(num) && num >= 0 && num <= 100 ? { ok: true, value: Math.round(num * 10) / 10 } : { ok: false, error: 'Enter a percentage from 0 to 100' }
    case 'elevation?': {
      if (!Number.isFinite(num)) return { ok: false, error: `Enter a number of ${unit === 'ft' ? 'feet' : 'metres'}` }
      const m = Math.round((unit === 'ft' ? ftToM(num) : num) * 10) / 10
      return m >= -500 && m <= 9000 ? { ok: true, value: m } : { ok: false, error: 'That elevation looks wrong' }
    }
    case 'lat':
      return Number.isFinite(num) && num >= -90 && num <= 90 ? { ok: true, value: num } : { ok: false, error: 'Latitude is between −90 and 90' }
    case 'lon':
      return Number.isFinite(num) && num >= -180 && num <= 180 ? { ok: true, value: num } : { ok: false, error: 'Longitude is between −180 and 180' }
    case 'bool?':
      if (s === 'yes' || s === 'true') return { ok: true, value: true }
      if (s === 'no' || s === 'false') return { ok: true, value: false }
      if (s === 'unknown') return { ok: true, value: null }
      return { ok: false, error: 'Choose yes, no or unknown' }
    case 'date?':
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s).isValid ? { ok: true, value: s } : { ok: false, error: 'Enter a date (YYYY-MM-DD)' }
    case 'url?': {
      if (s.length > 500) return { ok: false, error: 'That link is too long' }
      try {
        const u = new URL(s)
        return u.protocol === 'https:' || u.protocol === 'http:' ? { ok: true, value: u.toString() } : { ok: false, error: 'Links must start with https:// or http://' }
      } catch {
        return { ok: false, error: 'Enter the full link, starting with https://' }
      }
    }
    case 'tz':
      return isZone(s) ? { ok: true, value: s } : { ok: false, error: 'Unknown time zone (use an IANA name such as America/Denver)' }
  }
}

/** The value as it would be typed back into the form (elevations in the display unit). */
export function toInputValue(kind: FieldKind, value: unknown, unit: 'ft' | 'm' = 'm'): string {
  if (value === null || value === undefined) return ''
  if (kind === 'bool?') return value === true ? 'yes' : value === false ? 'no' : 'unknown'
  if (kind === 'elevation?' && typeof value === 'number') return String(Math.round(unit === 'ft' ? value / 0.3048 : value))
  return String(value)
}

// ---------------------------------------------------------------------------
// Display

/** Human text for a stored value; `null` means unknown. */
export function formatCorrectionValue(kind: FieldKind, value: unknown, units: UnitPrefs): string {
  if (value === null || value === undefined) return kind === 'bool?' ? 'Unknown' : 'Unknown / not set'
  switch (kind) {
    case 'bool?':
      return value === true ? 'Yes' : value === false ? 'No — not offered' : String(value)
    case 'elevation?':
      return typeof value === 'number' ? `${formatElevation(value, units)}${units.elevation === 'ft' ? ` (${Math.round(value).toLocaleString('en-US')} m stored)` : ''}` : String(value)
    case 'pct?':
      return typeof value === 'number' ? `${value}%` : String(value)
    case 'int?':
    case 'number?':
      return typeof value === 'number' ? value.toLocaleString('en-US') : String(value)
    case 'lat':
    case 'lon':
      return typeof value === 'number' ? `${value.toFixed(4)}°` : String(value)
    case 'date?':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? DateTime.fromISO(value, { zone: 'UTC' }).toFormat('ccc d LLL yyyy') : String(value)
    case 'url?':
      return typeof value === 'string' ? value.replace(/^https?:\/\//, '').replace(/\/$/, '') : String(value)
    default:
      return typeof value === 'string' ? value : JSON.stringify(value)
  }
}
