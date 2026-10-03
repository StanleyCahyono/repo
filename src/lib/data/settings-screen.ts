/**
 * Settings read model: preferences plus everything the Settings page explains next to them — stored exchange rates,
 * airports for the origin list, owned passes, alert rules and recent alerts, and manual catalog corrections.
 *
 * Honesty rules
 * - Units and currency are display choices: nothing here converts or rewrites a stored value.
 * - Exchange rates are shown only when stored (with date, provider and kind); live mode never shows demo rates.
 * - Corrections are listed with the catalog value they replace, and with the reason when one could not be applied.
 */
import 'server-only'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { AlertType } from '@/lib/db/schema'
import type { ResortRow, ResortSeasonRow } from '@/lib/db/rows'
import { findRate } from '@/lib/domain/costs/fx'
import type { Money } from '@/lib/domain/money'
import type { PassFamilyId } from '@/lib/domain/types'
import { DISPLAY_CURRENCIES } from '@/components/settings/options'
import { applyOverrides, isLive, loadPassData, seasonLabel, type DataCtx, type OverrideRow } from './core'
import { shownAirport, shownResort, shownSeason } from './shown'
import { lastAttemptRun, lastSuccess } from './deps'

// ---------------------------------------------------------------------------
// Shapes

export interface FxQuoteView {
  /** "1 USD = 1.3705 CAD". */
  from: string
  to: string
  rate: string
  rateDate: string | null
  provider: string | null
  fetchedAt: string | null
  demo: boolean
}

export interface FxView {
  quotes: FxQuoteView[]
  /** Pairs Piste cannot convert yet (no stored rate). */
  missing: string[]
  job: {
    lastSuccessAt: string | null
    lastAttemptAt: string | null
    lastAttemptStatus: string | null
    lastError: string | null
    /** First note of the last attempt, e.g. "No foreign currencies in use" (nothing needed fetching). */
    lastNote: string | null
    /** The last attempt fetched nothing (every item skipped or none attempted). */
    lastFetchedNothing: boolean
  }
}

export interface AirportChoice {
  iata: string
  name: string
  city: string | null
  role: 'origin' | 'destination' | 'both'
  driveMinutes: number | null
  driveNote: string | null
}

export interface OwnedPassView {
  id: number
  holder: string
  productName: string
  familyId: PassFamilyId | null
  familyName: string | null
  purchasedOn: string | null
  pricePaid: Money | null
  daysLogged: number
}

export interface AlertRuleView {
  id: number
  type: AlertType
  resortId: string | null
  resortName: string | null
  params: Record<string, unknown>
  enabled: boolean
  cooldownHours: number
  lastFiredAt: string | null
  fired: number
  createdAt: string
}

export interface RecentAlertView {
  id: number
  type: AlertType
  title: string
  firedAt: string
  read: boolean
  link: string | null
}

export interface CorrectionItem {
  resortId: string
  resortName: string
  field: string
  value: unknown
  /** The value before any correction (catalog/seeded row); null = unknown there too. */
  catalogValue: unknown
  note: string | null
  sourceUrl: string | null
  at: string
  applied: boolean
  reason: string | null
  /** Rows kept for this resort + field (the newest is applied). */
  revisions: number
}

export interface ResortChoice {
  id: string
  name: string
  shortName: string
  region: string
  favorite: boolean
}

export interface SettingsView {
  mode: DataCtx['mode']
  now: string
  today: string
  prefs: DataCtx['prefs']
  seasons: { id: string; label: string; startDate: string; endDate: string }[]
  airports: AirportChoice[]
  ownedPasses: OwnedPassView[]
  fx: FxView
  resorts: ResortChoice[]
  alerts: { rules: AlertRuleView[]; recent: RecentAlertView[]; unread: number }
  corrections: CorrectionItem[]
}

// ---------------------------------------------------------------------------
// Corrections (shared with Sources & Sync)

function valueAt(resort: ResortRow, season: ResortSeasonRow | null, field: string): unknown {
  const [group, key] = field.includes('.') ? (field.split('.', 2) as [string, string]) : [null, field]
  const pick = (obj: unknown, k: string) => (obj && typeof obj === 'object' ? ((obj as Record<string, unknown>)[k] ?? null) : null)
  if (group === null) return pick(resort, key)
  if (group === 'terrain') return pick(resort.terrain, key)
  if (group === 'features') return pick(resort.features, key)
  if (group === 'links') return pick(resort.links, key)
  if (group === 'season') return pick(season, key)
  return null
}

/** Latest correction per resort + field, with the catalog value it replaces and whether it could be applied. */
export async function loadCorrections(ctx: Pick<DataCtx, 'db' | 'prefs'>): Promise<CorrectionItem[]> {
  const overrides = await ctx.db.select().from(s.resortOverrides)
  if (!overrides.length) return []
  const ids = [...new Set(overrides.map((o) => o.resortId))]
  const [resorts, seasons] = await Promise.all([
    ctx.db
      .select()
      .from(s.resorts)
      .where(inArray(s.resorts.id, ids))
      .then((rows) => rows.map(shownResort)),
    ctx.db
      .select()
      .from(s.resortSeasons)
      .where(and(inArray(s.resortSeasons.resortId, ids), eq(s.resortSeasons.seasonId, ctx.prefs.activeSeasonId)))
      .then((rows) => rows.map(shownSeason)),
  ])
  const byResort = new Map<string, OverrideRow[]>()
  for (const o of overrides) byResort.set(o.resortId, [...(byResort.get(o.resortId) ?? []), o])
  const out: CorrectionItem[] = []
  for (const r of resorts) {
    const rows = byResort.get(r.id) ?? []
    const season = seasons.find((x) => x.resortId === r.id) ?? null
    const { corrections } = applyOverrides(r, season, rows)
    for (const c of corrections) {
      out.push({
        resortId: r.id,
        resortName: r.name,
        field: c.field,
        value: c.value,
        catalogValue: valueAt(r, season, c.field),
        note: c.note,
        sourceUrl: c.sourceUrl,
        at: c.at,
        applied: c.applied,
        reason: c.reason,
        revisions: rows.filter((o) => o.field === c.field).length,
      })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.resortName.localeCompare(b.resortName) || a.field.localeCompare(b.field))
}

export async function loadResortChoices(ctx: Pick<DataCtx, 'db'>): Promise<ResortChoice[]> {
  const [rows, favs] = await Promise.all([
    ctx.db.select({ id: s.resorts.id, name: s.resorts.name, shortName: s.resorts.shortName, region: s.resorts.region, priority: s.resorts.priority }).from(s.resorts),
    ctx.db.select().from(s.favorites),
  ])
  const fav = new Map(favs.map((f) => [f.resortId, f.sortOrder]))
  return rows
    .sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || (fav.get(a.id) ?? 0) - (fav.get(b.id) ?? 0) || b.priority - a.priority || a.name.localeCompare(b.name))
    .map((r) => ({ id: r.id, name: r.name, shortName: r.shortName || r.name, region: r.region, favorite: fav.has(r.id) }))
}

// ---------------------------------------------------------------------------

async function loadFx(ctx: DataCtx): Promise<FxView> {
  const live = isLive(ctx)
  const rates = await ctx.db.select().from(s.fxRates).where(live ? sql`${s.fxRates.kind} <> 'demo'` : undefined)
  const quotes: FxQuoteView[] = []
  const missing: string[] = []
  for (const to of DISPLAY_CURRENCIES.filter((c) => c !== 'USD')) {
    const fx = findRate(rates, 'USD', to, { asOf: ctx.today })
    if (!fx) {
      missing.push(to)
      continue
    }
    const newestLeg = [...fx.legs].sort((a, b) => (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? ''))[0]
    quotes.push({
      from: 'USD',
      to,
      rate: Number(fx.rate).toFixed(4),
      rateDate: fx.rateDate,
      provider: fx.provider,
      fetchedAt: newestLeg?.fetchedAt ?? null,
      demo: fx.legs.some((l) => l.kind === 'demo'),
    })
  }
  const [success, attempt] = live ? await Promise.all([lastSuccess(ctx.db, 'fx'), lastAttemptRun(ctx.db, 'fx')]) : [null, null]
  return {
    quotes,
    missing,
    job: {
      lastSuccessAt: success,
      lastAttemptAt: attempt?.startedAt ?? null,
      lastAttemptStatus: attempt?.status ?? null,
      lastError: attempt?.error ?? null,
      lastNote: attempt?.details?.notes?.[0] ?? null,
      lastFetchedNothing: !!attempt && !(attempt.details?.items ?? []).some((i) => !i.skipped),
    },
  }
}

export async function getSettingsView(ctx: DataCtx): Promise<SettingsView> {
  const { db } = ctx
  const [seasons, airports, pass, fx, resorts, rules, fired, recent, unread, corrections] = await Promise.all([
    db.select().from(s.seasons),
    db
      .select()
      .from(s.airports)
      .then((rows) => rows.map(shownAirport)),
    loadPassData(db, ctx.prefs.activeSeasonId),
    loadFx(ctx),
    loadResortChoices(ctx),
    db.select().from(s.alertRules).orderBy(s.alertRules.id),
    db
      .select({ ruleId: s.alerts.ruleId, n: sql<number>`count(*)` })
      .from(s.alerts)
      .groupBy(s.alerts.ruleId),
    db.select().from(s.alerts).orderBy(desc(s.alerts.firedAt), desc(s.alerts.id)).limit(5),
    db
      .select({ n: sql<number>`count(*)` })
      .from(s.alerts)
      .where(isNull(s.alerts.readAt)),
    loadCorrections(ctx),
  ])
  const names = new Map(resorts.map((r) => [r.id, r.name]))
  const firedBy = new Map(fired.map((f) => [f.ruleId, Number(f.n)]))
  const familyName = new Map(pass.families.map((f) => [f.id, f.name]))

  return {
    mode: ctx.mode,
    now: ctx.now,
    today: ctx.today,
    prefs: ctx.prefs,
    seasons: (seasons.length ? seasons : [{ id: ctx.prefs.activeSeasonId, label: seasonLabel(ctx.prefs.activeSeasonId), startDate: '', endDate: '' }])
      .map((x) => ({ id: x.id, label: x.label, startDate: x.startDate, endDate: x.endDate }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    airports: airports
      .map((a) => ({
        iata: a.iata,
        name: a.name,
        city: a.city,
        role: a.role,
        driveMinutes: a.driveFromHome?.minutes ?? null,
        driveNote: a.driveFromHome?.basis ?? null,
      }))
      .sort((a, b) => Number(b.role !== 'destination') - Number(a.role !== 'destination') || (a.driveMinutes ?? 1e9) - (b.driveMinutes ?? 1e9) || a.iata.localeCompare(b.iata)),
    ownedPasses: pass.owned.map((o) => ({
      id: o.ownership.id,
      holder: o.ownership.holder,
      productName: o.product.name,
      familyId: isPassFamily(o.product.familyId) ? o.product.familyId : null,
      familyName: familyName.get(o.product.familyId) ?? null,
      purchasedOn: o.ownership.purchasedOn,
      pricePaid: o.ownership.pricePaidMinor !== null && o.ownership.currency ? { amountMinor: o.ownership.pricePaidMinor, currency: o.ownership.currency } : null,
      daysLogged: o.usage.length,
    })),
    fx,
    resorts,
    alerts: {
      rules: rules.map((r) => ({
        id: r.id,
        type: r.type,
        resortId: r.resortId,
        resortName: r.resortId ? (names.get(r.resortId) ?? r.resortId) : null,
        params: r.params ?? {},
        enabled: r.enabled,
        cooldownHours: r.cooldownHours,
        lastFiredAt: r.lastFiredAt,
        fired: firedBy.get(r.id) ?? 0,
        createdAt: r.createdAt,
      })),
      recent: recent.map((a) => ({ id: a.id, type: a.type, title: a.title, firedAt: a.firedAt, read: a.readAt !== null, link: a.link })),
      unread: Number(unread[0]?.n ?? 0),
    },
    corrections,
  }
}

/** Keeps unknown family ids out of pass badges. */
export function isPassFamily(id: string | null): id is PassFamilyId {
  return id === 'ikon' || id === 'epic' || id === 'indy' || id === 'mountain-collective' || id === 'regional'
}
