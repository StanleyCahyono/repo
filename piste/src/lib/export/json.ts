/**
 * Personal-data export (JSON) — pure builders. The collector that reads the database lives in ./collect.ts.
 * Demo exports are labelled in the payload and the filename and never mix with live data (separate databases).
 */
import { DateTime } from 'luxon'
import type { AppMode } from '@/lib/domain/types'

export const EXPORT_FORMAT = 'piste-personal-export'
export const EXPORT_VERSION = 1

/** Personal tables in export order. Keys are the names used by `/api/export/csv?table=`. */
export const PERSONAL_TABLES = [
  'preferences',
  'favorites',
  'ratings',
  'pass-ownership',
  'pass-usage',
  'trips',
  'trip-items',
  'trip-checklist',
  'checklist-templates',
  'ski-logs',
  'skills',
  'lessons',
  'expenses',
  'alert-rules',
  'manual-reports',
  'resort-overrides',
  'my-resorts',
  'my-hotels',
  'my-events',
  'price-estimates',
] as const
export type PersonalTable = (typeof PERSONAL_TABLES)[number]

export const PERSONAL_TABLE_LABEL: Record<PersonalTable, string> = {
  preferences: 'Preferences',
  favorites: 'Favorites',
  ratings: 'My ratings',
  'pass-ownership': 'Pass ownership',
  'pass-usage': 'Pass usage',
  trips: 'Trips',
  'trip-items': 'Trip items',
  'trip-checklist': 'Trip checklists',
  'checklist-templates': 'Checklist templates',
  'ski-logs': 'Ski-day journal',
  skills: 'Skills',
  lessons: 'Lessons',
  expenses: 'Expenses',
  'alert-rules': 'Alert rules',
  'manual-reports': 'Manual and personal reports',
  'resort-overrides': 'Resort corrections',
  'my-resorts': 'Resorts I added',
  'my-hotels': 'Hotels I added',
  'my-events': 'Events I added',
  'price-estimates': 'My price estimates',
}

export function isPersonalTable(s: string): s is PersonalTable {
  return (PERSONAL_TABLES as readonly string[]).includes(s)
}

export type PersonalData = Record<PersonalTable, Record<string, unknown>[]>

export interface PersonalExport {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  mode: AppMode
  demo: boolean
  /** Present on demo exports. */
  label: string | null
  notes: string[]
  counts: Record<PersonalTable, number>
  tables: PersonalData
}

export const DEMO_LABEL = 'DEMO DATA — generated sample records, not personal data'

export function buildJsonExport(data: PersonalData, a: { now: string; mode: AppMode }): PersonalExport {
  const demo = a.mode === 'demo'
  const tables = Object.fromEntries(PERSONAL_TABLES.map((t) => [t, data[t] ?? []])) as PersonalData
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: a.now,
    mode: a.mode,
    demo,
    label: demo ? DEMO_LABEL : null,
    notes: [
      'Units are canonical metric (cm, mm, °C, km/h, m, km); money is integer minor units with an ISO 4217 currency.',
      'Instants are UTC ISO-8601; resort days are YYYY-MM-DD in the resort time zone.',
      'null means unknown — never zero.',
    ],
    counts: Object.fromEntries(PERSONAL_TABLES.map((t) => [t, tables[t].length])) as Record<PersonalTable, number>,
    tables,
  }
}

/** `piste-export-20270115-1400.json`; demo: `piste-DEMO-export-…`. UTC stamp. */
export function exportFileName(stem: string, ext: 'json' | 'csv' | 'ics', a: { now: string; mode: AppMode }): string {
  const stamp = DateTime.fromISO(a.now, { zone: 'utc' }).toFormat('yyyyMMdd-HHmm')
  const safe = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `piste-${a.mode === 'demo' ? 'DEMO-' : ''}${safe || 'export'}-${stamp}.${ext}`
}

/** RFC 6266 Content-Disposition with an ASCII fallback. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
