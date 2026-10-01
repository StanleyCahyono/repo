/**
 * Forecast page URL state. Everything a visitor sets on /forecast lives in the query string, so returning from a
 * resort (or sharing a link) restores the same view. Parsing is lenient: invalid values fall back to defaults.
 *
 *   /forecast?r=alta,greek-peak&focus=alta&pt=summit&date=2027-01-16&month=2027-01&mode=learning&metric=snow
 *
 *   r       resorts to compare, comma-separated ids (max 4). Absent → favourites; present but empty → none chosen.
 *   focus   resort shown in the hourly timeline and the history calendar (one of r; default the first).
 *   pt      weather point: 'base' (default) or 'summit' (upper mountain).
 *   date    selected resort-local date: past → that history day opens; within the forecast → that outlook day;
 *           beyond the forecast → planning information (no forecast is invented).
 *   month   history calendar month 'YYYY-MM' (default: the month of a past `date`, else the current month).
 *   mode    scoring mode for weather potential / estimates then (default: your preference).
 *   metric  daily outlook cells: snow (default) | potential | temp | wind.
 *
 * Other screens can deep-link with `forecastHref({ resorts: ['alta'], date: '2027-01-10' })`, adding `#history`,
 * `#hourly` or `#daily` to land on a section.
 */
import { SCORING_MODES, type ScoringMode } from '@/lib/domain/types'

export const MAX_COMPARE = 4

export type PointKey = 'base' | 'summit'
export type OutlookMetric = 'snow' | 'potential' | 'temp' | 'wind'
export const OUTLOOK_METRICS: readonly OutlookMetric[] = ['snow', 'potential', 'temp', 'wind']

export interface ForecastParams {
  /** null = not specified (use favourites); [] = explicitly none. */
  resorts: string[] | null
  focus: string | null
  point: PointKey
  date: string | null
  month: string | null
  mode: ScoringMode | null
  metric: OutlookMetric
}

export const DEFAULT_PARAMS: ForecastParams = { resorts: null, focus: null, point: 'base', date: null, month: null, mode: null, metric: 'snow' }

const ID_RE = /^[a-z0-9-]{1,80}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams

function first(sp: RawParams, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined
  const v = sp[key]
  return Array.isArray(v) ? v[0] : v
}

/** A real calendar date 'YYYY-MM-DD' (rejects 2027-02-30). */
export function validDate(v: string | null | undefined): string | null {
  if (!v) return null
  const m = DATE_RE.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v : null
}

export function validMonth(v: string | null | undefined): string | null {
  if (!v) return null
  const m = MONTH_RE.exec(v)
  if (!m) return null
  const mo = Number(m[2])
  return mo >= 1 && mo <= 12 ? v : null
}

/** Resort ids from a comma list: well-formed, de-duplicated, at most MAX_COMPARE. */
export function parseResortList(v: string | undefined): string[] | null {
  if (v === undefined) return null
  const out: string[] = []
  for (const raw of v.split(',')) {
    const id = raw.trim().toLowerCase()
    if (ID_RE.test(id) && !out.includes(id)) out.push(id)
    if (out.length === MAX_COMPARE) break
  }
  return out
}

export function parseForecastParams(sp: RawParams): ForecastParams {
  const pt = first(sp, 'pt')
  const mode = first(sp, 'mode')
  const metric = first(sp, 'metric')
  const focus = first(sp, 'focus')?.trim().toLowerCase()
  return {
    resorts: parseResortList(first(sp, 'r')),
    focus: focus && ID_RE.test(focus) ? focus : null,
    point: pt === 'summit' ? 'summit' : 'base',
    date: validDate(first(sp, 'date')),
    month: validMonth(first(sp, 'month')),
    mode: (SCORING_MODES as readonly string[]).includes(mode ?? '') ? (mode as ScoringMode) : null,
    metric: (OUTLOOK_METRICS as readonly string[]).includes(metric ?? '') ? (metric as OutlookMetric) : 'snow',
  }
}

/** Query string for a state; defaults are omitted so URLs stay short. Leading '?' included when non-empty. */
export function forecastQuery(p: Partial<ForecastParams>): string {
  const q = new URLSearchParams()
  if (p.resorts !== undefined && p.resorts !== null) q.set('r', p.resorts.slice(0, MAX_COMPARE).join(','))
  if (p.focus) q.set('focus', p.focus)
  if (p.point && p.point !== 'base') q.set('pt', p.point)
  if (p.date) q.set('date', p.date)
  if (p.month) q.set('month', p.month)
  if (p.mode) q.set('mode', p.mode)
  if (p.metric && p.metric !== 'snow') q.set('metric', p.metric)
  const s = q.toString().replace(/%2C/g, ',')
  return s ? `?${s}` : ''
}

export function forecastHref(p: Partial<ForecastParams> = {}, hash?: 'hourly' | 'daily' | 'history' | 'beyond'): string {
  return `/forecast${forecastQuery(p)}${hash ? `#${hash}` : ''}`
}

/**
 * Merge a patch into the current query string: null removes a key, '' keeps it explicitly empty (`r=` means "no
 * resorts chosen", unlike an absent `r` which means "use favourites"), undefined leaves it alone. Returns '?…' or ''.
 * Unknown keys survive.
 */
export function patchQuery(current: string | URLSearchParams, patch: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(typeof current === 'string' ? current.replace(/^\?/, '') : current.toString())
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === null) q.delete(k)
    else q.set(k, v)
  }
  const s = q.toString().replace(/%2C/g, ',')
  return s ? `?${s}` : ''
}
