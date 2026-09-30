/**
 * Display helpers for the resort page. Pure (no React, no DB) so server components and client islands share them.
 * Stored values are metric; display units come from the user's preferences. Unknown stays null — callers render
 * <Missing/> rather than a zero.
 */
import { greatCircleKm } from '@/lib/domain/geo'
import { addDays, formatInstant, formatLocalDate, hoursBetween, relativeLabel } from '@/lib/domain/time'
import { formatDistance, formatDuration, formatElevation, formatSnow, formatSpeed, formatTemp, formatVisibility, formatPrecip, snowValue } from '@/lib/domain/units'
import type { Provenance, ScoringMode, UnitPrefs } from '@/lib/domain/types'
import type { SourceItem } from '@/components/ui/source-drawer'

/** Everything date/unit/clock related a section needs, resolved once by the page. */
export interface PageView {
  id: string
  name: string
  shortName: string
  /** Planning date (resort-local) every date-specific fact describes. */
  date: string
  /** Resort-local today (app clock). */
  today: string
  /** Home-local today (app clock). */
  homeToday: string
  now: string
  mode: ScoringMode
  units: UnitPrefs
  /** Resort IANA zone and its abbreviation on the planning date. */
  tz: string
  zone: string
  demo: boolean
  homeName: string
  homeLat: number
  homeLon: number
}

export const SECTIONS = [
  { id: 'overview', label: 'Overview', short: 'Overview' },
  { id: 'conditions', label: 'Conditions', short: 'Conditions' },
  { id: 'lifts', label: 'Lifts & runs', short: 'Lifts' },
  { id: 'plan', label: 'Plan a visit', short: 'Plan' },
  { id: 'getting-there', label: 'Getting there', short: 'Travel' },
  { id: 'stay', label: 'Stay & après', short: 'Stay' },
  { id: 'links', label: 'Maps & links', short: 'Links' },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']

/** 'Fri 15 Jan' */
export const dayLabel = (date: string) => formatLocalDate(date, 'ccc d LLL')
/** 'Fri 15 Jan 2027' */
export const dayLabelYear = (date: string) => formatLocalDate(date, 'ccc d LLL yyyy')
/** 'Friday 15 January 2027' */
export const dayLabelLong = (date: string) => formatLocalDate(date, 'cccc d LLLL yyyy')
/** '15 Jan 2027' */
export const shortDate = (date: string) => formatLocalDate(date, 'd LLL yyyy')

/** Instant in a zone: 'Fri 15 Jan, 07:10' (+ year when not the current one). */
export function instantLabel(instant: string, tz: string, now?: string): string {
  const sameYear = now ? instant.slice(0, 4) === now.slice(0, 4) : true
  return formatInstant(instant, tz, sameYear ? 'ccc d LLL, HH:mm' : 'ccc d LLL yyyy, HH:mm')
}

export function ago(instant: string | null | undefined, now: string): string | null {
  return instant ? relativeLabel(instant, now) : null
}

export function isStale(instant: string | null | undefined, now: string, hours: number): boolean {
  return !!instant && hoursBetween(instant, now) > hours
}

export const seasonText = (id: string | null | undefined) => (id ? id.replace('-', '–') : null)

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function units(u: UnitPrefs) {
  return {
    snow: (cm: number | null | undefined) => formatSnow(cm, u),
    snowNumber: (cm: number | null | undefined) => snowValue(cm, u),
    snowUnit: u.snow === 'in' ? 'in' : 'cm',
    snowSymbol: u.snow === 'in' ? '″' : 'cm',
    temp: (c: number | null | undefined) => formatTemp(c, u),
    speed: (kmh: number | null | undefined) => formatSpeed(kmh, u),
    elev: (m: number | null | undefined) => formatElevation(m, u),
    dist: (km: number | null | undefined) => formatDistance(km, u),
    vis: (m: number | null | undefined) => formatVisibility(m, u),
    precip: (mm: number | null | undefined) => formatPrecip(mm, u),
    duration: (min: number | null | undefined) => formatDuration(min),
  }
}
export type Units = ReturnType<typeof units>

/** Research-grade or unverified catalog facts are "confirm at source", never presented as verified. */
/**
 * Wording for a fact that still needs confirming: web-search research is "Researched — confirm at source"; an
 * unverified catalog entry is Piste reference data ("Reference — confirm at source").
 */
export function confirmText(p: Provenance | null | undefined): string {
  if (p?.verification === 'search-summary') return 'Researched — confirm at source'
  if (p?.verification === 'unverified') return 'Reference — confirm at source'
  return 'Confirm at source'
}

export function needsCheck(p: Provenance | null | undefined): boolean {
  if (!p) return true
  const v = p.verification ?? null
  if (p.kind === 'manual' || p.kind === 'historical') return v === null || v === 'search-summary' || v === 'unverified'
  return v === 'search-summary' || v === 'unverified'
}

export function verificationText(p: Provenance | null | undefined): string {
  if (!p) return 'No source recorded'
  switch (p.verification) {
    case 'search-summary':
      return 'Researched — confirm at source'
    case 'unverified':
      return 'Reference data — confirm at source'
    case 'user-confirmed':
      return 'Confirmed by you'
    case 'official-page':
      return 'Read from the official page'
    case 'api':
      return 'Official API'
    default:
      return p.kind === 'modeled' ? 'Weather model' : p.kind === 'derived' ? 'Piste estimate' : p.kind === 'demo' ? 'Demo data' : 'Not verified'
  }
}

export function src(label: string, prov: Provenance | null | undefined, value?: SourceItem['value']): SourceItem {
  return { label, prov: prov ?? null, value }
}

/** Joins non-empty parts with a middle dot. */
export function dotJoin(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' · ')
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** '[1,2,3,4,5]' → 'Mon–Fri'; '[6,7]' → 'Sat–Sun'; null → 'Days not stated'. */
export function weekdaysText(days: number[] | null | undefined): string {
  if (!days || !days.length) return 'Days not stated'
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  const runs: number[][] = []
  for (const d of sorted) {
    const last = runs[runs.length - 1]
    if (last && d === last[last.length - 1] + 1) last.push(d)
    else runs.push([d])
  }
  return runs.map((r) => (r.length >= 3 ? `${WEEKDAY_SHORT[r[0]]}–${WEEKDAY_SHORT[r[r.length - 1]]}` : r.map((d) => WEEKDAY_SHORT[d]).join(', '))).join(', ')
}

/** '09:30' → '9:30'; keeps 24-hour clock (resort-local). */
export function clock(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':')
  return `${Number(h)}:${m}`
}

// ---------------------------------------------------------------------------
// Labels

export const ACTIVITY_LABEL: Record<string, string> = {
  lifts: 'Lifts',
  'night-skiing': 'Night skiing',
  'ticket-office': 'Ticket office',
  rentals: 'Rentals',
  lessons: 'Lessons',
  tubing: 'Tubing',
  other: 'Other',
}
/** The activities the brief asks for, in display order (others follow when recorded). */
export const CORE_ACTIVITIES = ['lifts', 'night-skiing', 'ticket-office', 'rentals', 'lessons'] as const

export const WINDOW_LABEL: Record<string, string> = {
  overnight: 'Overnight',
  '24h': '24 hours',
  '48h': '48 hours',
  '72h': '72 hours',
  '7d': '7 days',
  storm: 'Storm total',
  season: 'Season total',
}
export const WINDOW_ORDER = ['overnight', '24h', '48h', '72h', '7d', 'storm', 'season']

export const REPORT_ORIGIN_LABEL: Record<string, string> = {
  'official-adapter': 'Official report (read by Piste)',
  'official-by-user': 'Official report entered by you',
  'manual-transcribed': 'Typed by you from the source',
  personal: 'Your own observation',
  demo: 'Simulated report (demo)',
  other: 'Report',
}

export const HOTEL_TIER_LABEL: Record<string, string> = { budget: 'Budget', comfortable: 'Comfortable', premium: 'Premium' }

export const EVENT_STATUS_TEXT: Record<string, string> = {
  announced: 'Announced',
  tentative: 'Tentative',
  'not-announced': 'Date not announced',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
}

export const TRANSFER_TYPE_LABEL: Record<string, string> = {
  bus: 'Bus',
  shuttle: 'Shuttle',
  'rental-car': 'Rental car',
  private: 'Private transfer',
  train: 'Train',
}

/** Tone for a pass-access verdict. Unknown is never positive (it is not permission). */
export function accessTone(status: string): 'positive' | 'caution' | 'critical' | 'unknown' {
  if (status === 'included' || status === 'included-limited') return 'positive'
  if (status === 'unknown') return 'unknown'
  if (status === 'discount-only') return 'caution'
  return 'critical'
}

// ---------------------------------------------------------------------------
// Link checks

export type LinkState = 'ok' | 'broken' | 'check-failed' | 'unknown' | 'unchecked'

export interface LinkCheckLike {
  ok: boolean | null
  httpStatus: number | null
  error: string | null
  checkedAt: string
}

/**
 * What a stored link check means for the reader.
 * - broken: the site answered that the page is gone or failing (404/410/5xx…).
 * - check-failed: the check itself was refused or could not connect (401/403/407/429, timeouts, network) — the
 *   link may well work in a browser, so it is never called broken.
 * - unknown: checked, result undetermined; unchecked: never checked.
 */
export function linkState(check: LinkCheckLike | null | undefined): LinkState {
  if (!check) return 'unchecked'
  if (check.ok === true) return 'ok'
  if (check.ok === null) return 'unknown'
  const s = check.httpStatus
  if (s !== null && [401, 403, 407, 429].includes(s)) return 'check-failed'
  if (s !== null && s >= 400) return 'broken'
  return 'check-failed'
}

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  ok: 'Link OK',
  broken: 'Broken',
  'check-failed': 'Check failed',
  unknown: 'Result unknown',
  unchecked: 'Not yet checked',
}

/** One-line explanation for a link's state (status code or error included when known). */
export function linkStateDetail(check: LinkCheckLike | null | undefined, now: string): string {
  const state = linkState(check)
  if (!check || state === 'unchecked') return 'The link checker has not visited this page yet'
  const when = relativeLabel(check.checkedAt, now)
  const code = check.httpStatus ? `HTTP ${check.httpStatus}` : (check.error ?? 'no response')
  switch (state) {
    case 'ok':
      return `Answered normally when checked ${when}`
    case 'broken':
      return `${code} when checked ${when} — the page may have moved`
    case 'check-failed':
      return `${code} when checked ${when} — the site or network refused the automated check; the page may still open in your browser`
    default:
      return `Checked ${when}; result undetermined`
  }
}

// ---------------------------------------------------------------------------
// Refresh errors

/**
 * Group a run's per-source errors by message: "Open-Meteo: HTTP 403 Forbidden" at base and upper mountain reads
 * as one line instead of four. `where` lists the weather points involved (empty for non-point sources).
 */
export function groupErrors(errors: readonly { source: string; message: string }[]): { message: string; where: string[] }[] {
  const out = new Map<string, Set<string>>()
  for (const e of errors) {
    const set = out.get(e.message) ?? new Set<string>()
    const first = e.source.split(' · ')[0]
    if (first === 'base' || first === 'summit') set.add(first === 'summit' ? 'upper mountain' : 'base')
    out.set(e.message, set)
  }
  return [...out].map(([message, where]) => ({ message, where: [...where] }))
}

// ---------------------------------------------------------------------------
// Weather-point labels

/** "Base · 350 m" / "Upper mountain · 2,100 ft" — the point Piste requested weather for. */
export function pointTitle(key: string): string {
  return key === 'summit' ? 'Upper mountain' : key === 'base' ? 'Base' : key
}

/** Straight-line distance in km between two coordinates (haversine) — labelled as straight-line wherever shown. */
export function straightLineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return greatCircleKm(a, b)
}

/** Arrival/return dates for prefilled flight searches: the planning date (never in the past) + `nights`. */
export function flightDates(date: string, today: string, nights = 3): { depart: string; ret: string } {
  const depart = date >= today ? date : today
  return { depart, ret: addDays(depart, nights) }
}
