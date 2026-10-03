/**
 * Picking the applicable price snapshot for a resort-day, and quote-expiry checks.
 *
 * A snapshot applies when subject, resort, category, season and date window match, its day type matches (or is
 * 'any'/unset), and it has not expired / its purchase-by date has not passed. Among applicable snapshots:
 *   1. source quality — published / observed-quote over user-estimate over demo;
 *   2. specificity — exact day type, a dated window (narrower wins), season, exact category;
 *   3. most recently observed.
 * No fallback across day types: a weekend price is not used for a holiday.
 */
import { DateTime } from 'luxon'
import { daysBetween, isLocalDate, seasonIdForHemisphere, type Hemisphere } from '../time'
import type { Provenance } from '../types'
import type { DayType } from './day-type'
import { providerLabel } from '../source-label'

export type QuoteKind = 'published' | 'observed-quote' | 'user-estimate' | 'demo'

/** Subset of PriceSnapshotRow. */
export interface PriceSnapshotInput {
  id?: number | null
  subjectType: string
  subjectId: string
  resortId: string | null
  item: string
  category: string | null
  amountMinor: number
  amountMaxMinor: number | null
  currency: string
  seasonId: string | null
  dayType: string | null
  appliesFrom: string | null
  appliesTo: string | null
  purchaseBy?: string | null
  includesTax?: boolean | null
  feesText?: string | null
  quoteKind: QuoteKind
  observedAt: string
  expiresAt: string | null
  prov?: Provenance | null
}

export interface PriceQuery {
  subjectType: string
  resortId: string
  date: string
  dayType: DayType
  /** Ticket category, e.g. 'adult'. Snapshots with no category are accepted as generic. */
  category?: string | null
  /** Optional item filter (e.g. a rental option). */
  item?: (item: string) => boolean
  /** ISO instant — for expiry. */
  now: string
  /** Home-local date — for date-only expiry / purchase-by. Defaults to the UTC date of `now`. */
  today?: string | null
  /**
   * The resort's hemisphere (default north): a season-tagged price applies in the resort's own season for `date` —
   * a Southern Hemisphere winter (June–October of year Y) is season '(Y-1)-(YY)'.
   */
  hemisphere?: Hemisphere
}

export interface PriceSelection {
  snapshot: PriceSnapshotInput | null
  /** Applicable candidates considered (including the chosen one). */
  candidates: number
  /** Snapshots that would have matched but are expired or past their purchase-by date. */
  expired: number
  /** Why this one: e.g. "published · weekend price · 2026-27". */
  basis: string | null
}

/** Unverified price facts are not shown or used (no source backs them); researched and confirmed prices are. */
export function isUnverifiedPrice(s: Pick<PriceSnapshotInput, 'prov'>): boolean {
  return s.prov?.verification === 'unverified'
}

const QUALITY: Record<QuoteKind, number> = { published: 2, 'observed-quote': 2, 'user-estimate': 1, demo: 0 }

export const QUOTE_KIND_LABEL: Record<QuoteKind, string> = {
  published: 'Published price',
  'observed-quote': 'Observed quote',
  'user-estimate': 'Your estimate',
  demo: 'Demo price',
}

/**
 * Has a quote/price expired? Date-only values are valid through that local day; instants expire at that instant.
 */
export function isExpired(expiresAt: string | null | undefined, now: string, today?: string | null): boolean {
  if (!expiresAt) return false
  if (isLocalDate(expiresAt)) return expiresAt < (today ?? now.slice(0, 10))
  const exp = DateTime.fromISO(expiresAt, { zone: 'utc' })
  const cur = DateTime.fromISO(now, { zone: 'utc' })
  if (!exp.isValid || !cur.isValid) return false
  return exp <= cur
}

/** An advance-purchase price whose purchase-by date has passed can no longer be bought. */
function purchaseWindowClosed(purchaseBy: string | null | undefined, now: string, today?: string | null): boolean {
  if (!purchaseBy) return false
  const d = purchaseBy.slice(0, 10)
  return isLocalDate(d) && d < (today ?? now.slice(0, 10))
}

function inWindow(s: PriceSnapshotInput, date: string): boolean {
  if (s.appliesFrom && date < s.appliesFrom.slice(0, 10)) return false
  if (s.appliesTo && date > s.appliesTo.slice(0, 10)) return false
  return true
}

function dayTypeScore(s: PriceSnapshotInput, dayType: DayType): number | null {
  const t = s.dayType?.toLowerCase() ?? null
  if (t === null || t === 'any') return 0
  if (t === dayType) return 4
  // 'peak' is only meaningful with a dated window (already checked by inWindow).
  if (t === 'peak') return s.appliesFrom && s.appliesTo ? 4 : null
  return null
}

export function selectPrice(snapshots: readonly PriceSnapshotInput[], q: PriceQuery): PriceSelection {
  const season = seasonIdForHemisphere(q.date, q.hemisphere ?? 'north')
  const category = q.category?.toLowerCase() ?? null
  let expired = 0
  const scored: { s: PriceSnapshotInput; quality: number; spec: number; span: number }[] = []

  for (const s of snapshots) {
    if (s.subjectType !== q.subjectType) continue
    if (isUnverifiedPrice(s)) continue
    if (!(s.resortId === q.resortId || (s.resortId == null && s.subjectId === q.resortId))) continue
    if (q.item && !q.item(s.item)) continue
    const cat = s.category?.toLowerCase() ?? null
    if (cat && category && cat !== category) continue
    if (s.seasonId && s.seasonId !== season) continue
    if (!inWindow(s, q.date)) continue
    const dt = dayTypeScore(s, q.dayType)
    if (dt === null) continue
    if (isExpired(s.expiresAt, q.now, q.today) || purchaseWindowClosed(s.purchaseBy, q.now, q.today)) {
      expired += 1
      continue
    }
    const windowed = !!(s.appliesFrom && s.appliesTo)
    const spec = dt + (windowed ? 2 : 0) + (s.seasonId ? 1 : 0) + (cat && category ? 1 : 0)
    const span = windowed ? daysBetween(s.appliesFrom!.slice(0, 10), s.appliesTo!.slice(0, 10)) : Number.MAX_SAFE_INTEGER
    scored.push({ s, quality: QUALITY[s.quoteKind] ?? 0, spec, span })
  }

  scored.sort(
    (a, b) =>
      b.quality - a.quality ||
      b.spec - a.spec ||
      a.span - b.span ||
      (a.s.observedAt < b.s.observedAt ? 1 : a.s.observedAt > b.s.observedAt ? -1 : 0) ||
      (b.s.id ?? 0) - (a.s.id ?? 0),
  )
  const best = scored[0]?.s ?? null
  return {
    snapshot: best,
    candidates: scored.length,
    expired,
    basis: best ? describeBasis(best) : null,
  }
}

function describeBasis(s: PriceSnapshotInput): string {
  const parts: string[] = [QUOTE_KIND_LABEL[s.quoteKind] ?? s.quoteKind]
  if (s.dayType && s.dayType !== 'any') parts.push(`${s.dayType} price`)
  // A snapshot with no recorded day type is accepted for any day; say so rather than imply it fits this one.
  if (!s.dayType) parts.push('day type not stated')
  if (s.appliesFrom && s.appliesTo) parts.push(`${s.appliesFrom.slice(0, 10)} – ${s.appliesTo.slice(0, 10)}`)
  if (s.seasonId) parts.push(s.seasonId)
  if (s.prov?.provider) parts.push(providerLabel(s.prov.provider)!)
  return parts.join(' · ')
}
