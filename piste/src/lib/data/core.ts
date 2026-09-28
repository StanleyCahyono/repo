/**
 * Shared, batched loading for the read models. Internal to src/lib/data — pages import the view loaders
 * (resorts.ts, today.ts, …), not this file.
 *
 * Every "latest X per resort" is resolved in SQL with a window function (one query for the ids, one for the rows),
 * so a page never issues one query per resort. Demo-kind rows are ignored in live mode as a second line of defence
 * (live and demo data already live in separate database files).
 */
import 'server-only'
import { and, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { Ctx } from '@/lib/context'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type {
  AirportRow,
  ConditionsAssessmentRow,
  EventRow,
  FavoriteRow,
  FxRateRow,
  OperationalReportRow,
  PassFamilyRow,
  PassOwnershipRow,
  PassProductRow,
  PassAccessRuleRow,
  PassUsageRow,
  PriceSnapshotRow,
  ResortRow,
  ResortSeasonRow,
  StatusEventRow,
  TravelOptionRow,
  WeatherAlertRow,
  WeatherRunRow,
} from '@/lib/db/rows'
import type { HourlyWeather } from '@/lib/providers/types'
import { localDateOf, seasonIdFor } from '@/lib/domain/time'
import { provenance, type Provenance, type ScoringMode } from '@/lib/domain/types'
import { PRIMARY_WEATHER_PROVIDERS, runSemantics } from './deps'

/** What every loader needs: the per-request context from getCtx() (or an equivalent object in tests/scripts). */
export type DataCtx = Pick<Ctx, 'db' | 'now' | 'today' | 'prefs' | 'mode'>

export const isLive = (ctx: Pick<DataCtx, 'mode'>) => ctx.mode !== 'demo'

/** '2026-27' → '2026–27'. */
export const seasonLabel = (id: string) => id.replace('-', '–')

export type OverrideRow = typeof s.resortOverrides.$inferSelect
export type LinkCheckRow = typeof s.linkChecks.$inferSelect

// ---------------------------------------------------------------------------
// Provenance helpers

export function derivedProv(provider: string, fetchedAt: string | null, note: string | null = null, kind: 'derived' | 'demo' = 'derived'): Provenance {
  return provenance({ kind, provider, fetchedAt, note })
}

/** Research-grade or unverified facts must be shown as "Researched — confirm at source". */
export function needsConfirmation(p: Provenance | null | undefined): boolean {
  if (!p) return true
  const v = p.verification ?? null
  if (p.kind === 'manual' || p.kind === 'historical') return v === null || v === 'search-summary' || v === 'unverified'
  return v === 'search-summary' || v === 'unverified'
}

export function verificationLabel(p: Provenance | null | undefined): string {
  if (!p) return 'No source recorded'
  switch (p.verification) {
    case 'search-summary':
      return 'Researched — confirm at source'
    case 'unverified':
      return 'Unverified — confirm at source'
    case 'user-confirmed':
      return 'Confirmed by you'
    case 'official-page':
      return 'Official page'
    case 'api':
      return 'Official API'
    default:
      return p.kind === 'modeled' ? 'Weather model' : p.kind === 'derived' ? 'Piste estimate' : p.kind === 'demo' ? 'Demo data' : 'Source not verified'
  }
}

// ---------------------------------------------------------------------------
// Manual corrections (resort_overrides), applied on read

export interface Correction {
  field: string
  value: unknown
  note: string | null
  sourceUrl: string | null
  at: string
  applied: boolean
  /** Why a correction could not be applied (unknown field, wrong type…). */
  reason: string | null
}

type Kind = 'string' | 'string?' | 'number' | 'number?' | 'bool?' | 'date?' | 'url?' | 'tz' | 'priority' | 'photo'

const RESORT_FIELDS: Record<string, Kind> = {
  name: 'string',
  shortName: 'string',
  country: 'string',
  region: 'string',
  stateProvince: 'string?',
  locality: 'string?',
  timezone: 'tz',
  operator: 'string?',
  lat: 'number',
  lon: 'number',
  baseElevationM: 'number?',
  summitElevationM: 'number?',
  verticalM: 'number?',
  character: 'string?',
  learning: 'string?',
  priority: 'priority',
  photo: 'photo',
}
const TERRAIN_FIELDS: Record<string, Kind> = {
  trails: 'number?',
  lifts: 'number?',
  skiableAcres: 'number?',
  beginnerPct: 'number?',
  intermediatePct: 'number?',
  advancedPct: 'number?',
  terrainParks: 'number?',
  season: 'string?',
}
const FEATURE_FIELDS: Record<string, Kind> = {
  nightSkiing: 'bool?',
  snowmakingPct: 'number?',
  lessons: 'bool?',
  rentals: 'bool?',
  onMountainLodging: 'bool?',
  tubing: 'bool?',
  childcare: 'bool?',
  beginnerArea: 'string?',
}
const LINK_FIELDS = [
  'official',
  'trailMap',
  'interactiveMap',
  'snowReport',
  'hours',
  'tickets',
  'seasonPass',
  'lessons',
  'rentals',
  'webcams',
  'parking',
  'roadInfo',
  'lodging',
  'events',
  'tourism',
  'avalanche',
  'openSkiMap',
] as const
const SEASON_FIELDS: Record<string, Kind> = {
  announcedOpening: 'date?',
  announcedOpeningText: 'string?',
  announcedClosing: 'date?',
  announcedClosingText: 'string?',
  actualOpening: 'date?',
  actualClosing: 'date?',
  estimatedOpenFrom: 'date?',
  estimatedOpenTo: 'date?',
  typicalOpeningText: 'string?',
  notes: 'string?',
}

function validValue(kind: Kind, v: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof v === 'string' && v.trim().length > 0
    case 'string?':
      return v === null || typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'number?':
      return v === null || (typeof v === 'number' && Number.isFinite(v))
    case 'bool?':
      return v === null || typeof v === 'boolean'
    case 'date?':
      return v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid)
    case 'url?':
      return v === null || (typeof v === 'string' && /^https?:\/\//.test(v))
    case 'tz':
      return typeof v === 'string' && DateTime.local().setZone(v).isValid
    case 'priority':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2
    case 'photo': {
      if (v === null) return true
      const p = v as Record<string, unknown>
      return !!p && typeof p === 'object' && ['src', 'alt', 'credit', 'license', 'sourceUrl'].every((k) => typeof p[k] === 'string')
    }
  }
}

function correctionProv(prev: Provenance | null | undefined, c: Correction): Provenance {
  return provenance({
    kind: 'manual',
    provider: 'Your correction',
    sourceUrl: c.sourceUrl ?? prev?.sourceUrl ?? null,
    fetchedAt: c.at,
    verification: 'user-confirmed',
    season: prev?.season ?? null,
    note: c.note,
  })
}

/**
 * Apply manual corrections to a resort (and its season row). The latest correction per field wins. Unknown fields
 * or wrongly typed values are reported with `applied: false`, never applied. Returns new objects.
 */
export function applyOverrides(
  resort: ResortRow,
  season: ResortSeasonRow | null,
  overrides: readonly OverrideRow[],
): { resort: ResortRow; season: ResortSeasonRow | null; corrections: Correction[] } {
  const latest = new Map<string, OverrideRow>()
  for (const o of [...overrides].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))) {
    if (o.resortId === resort.id) latest.set(o.field, o)
  }
  if (latest.size === 0) return { resort, season, corrections: [] }

  const r: ResortRow = {
    ...resort,
    terrain: resort.terrain ? { ...resort.terrain } : null,
    features: resort.features ? { ...resort.features } : null,
    links: { ...resort.links },
  }
  const sr: ResortSeasonRow | null = season ? { ...season } : null
  const corrections: Correction[] = []
  for (const [field, o] of [...latest.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const c: Correction = { field, value: o.value ?? null, note: o.note, sourceUrl: o.sourceUrl, at: o.createdAt, applied: false, reason: null }
    corrections.push(c)
    const [group, key] = field.includes('.') ? (field.split('.', 2) as [string, string]) : [null, field]
    const v = o.value ?? null
    const reject = (reason: string) => {
      c.reason = reason
    }
    if (group === null) {
      const kind = RESORT_FIELDS[key]
      if (!kind) reject('Not a correctable field')
      else if (!validValue(kind, v)) reject('Value has the wrong type')
      else {
        ;(r as unknown as Record<string, unknown>)[key] = v
        if (key === 'lat' || key === 'lon') r.locationProv = correctionProv(r.locationProv, c)
        if (key.endsWith('ElevationM') || key === 'verticalM') r.elevationProv = correctionProv(r.elevationProv, c)
        c.applied = true
      }
    } else if (group === 'terrain') {
      const kind = TERRAIN_FIELDS[key]
      if (!kind) reject('Not a correctable terrain field')
      else if (!validValue(kind, v)) reject('Value has the wrong type')
      else {
        const t = r.terrain ?? { trails: null, lifts: null, skiableAcres: null, beginnerPct: null, intermediatePct: null, advancedPct: null, terrainParks: null, season: null, prov: null }
        r.terrain = { ...t, [key]: v, prov: correctionProv(t.prov, c) }
        c.applied = true
      }
    } else if (group === 'features') {
      const kind = FEATURE_FIELDS[key]
      if (!kind) reject('Not a correctable feature field')
      else if (!validValue(kind, v)) reject('Value has the wrong type')
      else {
        const f = r.features ?? { nightSkiing: null, snowmakingPct: null, lessons: null, rentals: null, onMountainLodging: null, tubing: null, childcare: null, beginnerArea: null, prov: null }
        r.features = { ...f, [key]: v, prov: correctionProv(f.prov, c) }
        c.applied = true
      }
    } else if (group === 'links') {
      if (!(LINK_FIELDS as readonly string[]).includes(key)) reject('Not a correctable link')
      else if (!validValue('url?', v)) reject('Links must be http(s) URLs')
      else {
        r.links = { ...r.links, [key]: v as string | null }
        c.applied = true
      }
    } else if (group === 'season') {
      const kind = SEASON_FIELDS[key]
      if (!kind) reject('Not a correctable season field')
      else if (!validValue(kind, v)) reject('Value has the wrong type')
      else if (!sr) reject('No season record to correct')
      else {
        ;(sr as unknown as Record<string, unknown>)[key] = v
        const provKey = `${key}Prov`
        if (provKey in sr) (sr as unknown as Record<string, unknown>)[provKey] = correctionProv((sr as unknown as Record<string, Provenance | null>)[provKey], c)
        c.applied = true
      }
    } else reject('Not a correctable field')
  }
  return { resort: r, season: sr, corrections }
}

// ---------------------------------------------------------------------------
// Bundle: everything date-independent, loaded once per page

export interface OwnedPass {
  ownership: PassOwnershipRow
  product: PassProductRow
  usage: PassUsageRow[]
}

export interface PassData {
  seasonId: string
  families: PassFamilyRow[]
  /** Products for the active season. */
  products: PassProductRow[]
  /** Rules (all versions) for those products. */
  rules: PassAccessRuleRow[]
  /** Owned products (any holder) for the active season, with logged usage. */
  owned: OwnedPass[]
}

export interface ResortRecord {
  row: ResortRow
  corrections: Correction[]
}

export interface Bundle {
  ctx: DataCtx
  live: boolean
  seasonId: string
  resorts: ResortRecord[]
  byId: Map<string, ResortRecord>
  /** Season rows keyed `${resortId}|${seasonId}` (corrections applied). */
  seasons: Map<string, ResortSeasonRow>
  favorites: Map<string, FavoriteRow>
  status: Map<string, StatusEventRow>
  travel: Map<string, TravelOptionRow[]>
  airports: Map<string, AirportRow>
  /** Resort-scoped price snapshots (lift tickets, rentals, parking, lessons, food…). */
  prices: Map<string, PriceSnapshotRow[]>
  fx: FxRateRow[]
  pass: PassData
  events: EventRow[]
  /** Active or upcoming official alerts per resort. */
  alerts: Map<string, WeatherAlertRow[]>
  /** Latest successful primary run per resort and weather point. */
  runs: Map<string, Map<string, WeatherRunRow>>
  names: Record<string, string>
}

export function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

export function resortToday(resort: Pick<ResortRow, 'timezone'>, now: string): string {
  return localDateOf(now, resort.timezone)
}

export async function loadBundle(ctx: DataCtx, opts: { ids?: readonly string[] | null; seasons?: readonly string[] } = {}): Promise<Bundle> {
  const { db, now } = ctx
  const live = isLive(ctx)
  const ids = opts.ids && opts.ids.length ? [...opts.ids] : null
  const seasonId = ctx.prefs.activeSeasonId
  const seasonIds = [...new Set([seasonId, ...(opts.seasons ?? [])])]
  const byResort = <T extends { resortId: string | null }>(rows: T[]) => groupBy(rows, (r) => r.resortId ?? '')

  const [resortRows, overrideRows, seasonRows, favRows, statusRows, travelRows, airportRows, priceRows, fxRows, pass, eventRows, alertRows, runs] =
    await Promise.all([
      ids ? db.select().from(s.resorts).where(inArray(s.resorts.id, ids)) : db.select().from(s.resorts),
      ids ? db.select().from(s.resortOverrides).where(inArray(s.resortOverrides.resortId, ids)) : db.select().from(s.resortOverrides),
      db
        .select()
        .from(s.resortSeasons)
        .where(and(inArray(s.resortSeasons.seasonId, seasonIds), ids ? inArray(s.resortSeasons.resortId, ids) : undefined)),
      db.select().from(s.favorites),
      latestStatusEvents(db, now, live, ids),
      ids ? db.select().from(s.travelOptions).where(inArray(s.travelOptions.resortId, ids)) : db.select().from(s.travelOptions),
      db.select().from(s.airports),
      db
        .select()
        .from(s.priceSnapshots)
        .where(
          and(
            inArray(s.priceSnapshots.subjectType, ['lift-ticket', 'rental', 'parking', 'lesson', 'food', 'other']),
            live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined,
            ids ? or(inArray(s.priceSnapshots.resortId, ids), inArray(s.priceSnapshots.subjectId, ids)) : undefined,
          ),
        ),
      db.select().from(s.fxRates).where(live ? sql`${s.fxRates.kind} <> 'demo'` : undefined),
      loadPassData(db, seasonId),
      ids
        ? db
            .select()
            .from(s.events)
            .where(inArray(s.events.resortId, ids))
        : db.select().from(s.events),
      db
        .select()
        .from(s.weatherAlerts)
        .where(and(or(sql`${s.weatherAlerts.ends} is null`, sql`${s.weatherAlerts.ends} > ${now}`), ids ? inArray(s.weatherAlerts.resortId, ids) : undefined)),
      latestRuns(db, now, live, ids),
    ])

  const overridesByResort = groupBy(overrideRows, (o) => o.resortId)
  const seasons = new Map<string, ResortSeasonRow>()
  const resorts: ResortRecord[] = []
  for (const row of resortRows.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))) {
    const ovs = overridesByResort.get(row.id) ?? []
    let corrections: Correction[] = []
    let resort = row
    for (const sid of seasonIds) {
      const srow = seasonRows.find((x) => x.resortId === row.id && x.seasonId === sid) ?? null
      const applied = applyOverrides(row, srow, sid === seasonId ? ovs : ovs.filter((o) => !o.field.startsWith('season.')))
      if (sid === seasonId) {
        resort = applied.resort
        corrections = applied.corrections
      }
      if (applied.season) seasons.set(`${row.id}|${sid}`, applied.season)
    }
    resorts.push({ row: resort, corrections })
  }
  const byId = new Map(resorts.map((r) => [r.row.id, r]))

  return {
    ctx,
    live,
    seasonId,
    resorts,
    byId,
    seasons,
    favorites: new Map(favRows.map((f) => [f.resortId, f])),
    status: new Map(statusRows.map((e) => [e.resortId, e])),
    travel: byResort(travelRows),
    airports: new Map(airportRows.map((a) => [a.iata, a])),
    prices: groupBy(priceRows, (p) => p.resortId ?? p.subjectId),
    fx: fxRows,
    pass,
    events: eventRows,
    alerts: groupBy(alertRows, (a) => a.resortId),
    runs,
    names: Object.fromEntries(resorts.map((r) => [r.row.id, r.row.shortName || r.row.name])),
  }
}

export async function loadPassData(db: Db, seasonId: string): Promise<PassData> {
  const [families, products] = await Promise.all([db.select().from(s.passFamilies), db.select().from(s.passProducts).where(eq(s.passProducts.seasonId, seasonId))])
  const productIds = products.map((p) => p.id)
  const [rules, ownership] = await Promise.all([
    productIds.length ? db.select().from(s.passAccessRules).where(inArray(s.passAccessRules.productId, productIds)) : Promise.resolve([] as PassAccessRuleRow[]),
    productIds.length ? db.select().from(s.passOwnership).where(inArray(s.passOwnership.productId, productIds)) : Promise.resolve([] as PassOwnershipRow[]),
  ])
  const usage = ownership.length
    ? await db
        .select()
        .from(s.passUsage)
        .where(
          inArray(
            s.passUsage.ownershipId,
            ownership.map((o) => o.id),
          ),
        )
    : []
  const productById = new Map(products.map((p) => [p.id, p]))
  const usageBy = groupBy(usage, (u) => u.ownershipId)
  return {
    seasonId,
    families,
    products,
    rules,
    owned: ownership
      .sort((a, b) => a.id - b.id)
      .map((o) => ({ ownership: o, product: productById.get(o.productId)!, usage: usageBy.get(o.id) ?? [] }))
      .filter((o) => !!o.product),
  }
}

// ---------------------------------------------------------------------------
// "Latest per group" queries (window functions; two queries each, never one per resort)

async function ids(db: Db, query: SQL): Promise<number[]> {
  const rows = await db.all<{ id: number | string }>(query)
  return rows.map((r) => Number(r.id))
}

function chunks<T>(xs: readonly T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Select rows by id in chunks (keeps SQLite parameter counts small). */
async function byIds<T>(idList: number[], fetch: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  if (!idList.length) return []
  const parts = await Promise.all(chunks(idList).map(fetch))
  return parts.flat()
}

export async function latestStatusEvents(db: Db, now: string, live: boolean, resortIds: readonly string[] | null = null): Promise<StatusEventRow[]> {
  const t = s.statusEvents
  const where = and(
    lte(t.effectiveAt, now),
    resortIds ? inArray(t.resortId, [...resortIds]) : undefined,
    live ? sql`coalesce(json_extract(${t.prov}, '$.kind'), '') <> 'demo'` : undefined,
  )
  const idList = await ids(
    db,
    sql`select id from (select ${t.id} as id, row_number() over (partition by ${t.resortId} order by ${t.effectiveAt} desc, ${t.id} desc) as rn from ${t} where ${where}) where rn = 1`,
  )
  return byIds(idList, (c) => db.select().from(t).where(inArray(t.id, c)))
}

/** Personal feedback is stored as a manual report with prov.note 'personal'; it is never operations evidence. */
const notPersonal = sql`not (${s.operationalReports.kind} = 'manual' and coalesce(json_extract(${s.operationalReports.prov}, '$.note'), '') = 'personal')`

/** Latest operations report per resort with localDate ≤ `date`, published by `now`. */
export async function latestReports(db: Db, opts: { date: string; now: string; live: boolean; resortIds?: readonly string[] | null }): Promise<Map<string, OperationalReportRow>> {
  const t = s.operationalReports
  const where = and(
    lte(t.localDate, opts.date),
    sql`(${t.reportedAt} is null or ${t.reportedAt} <= ${opts.now})`,
    notPersonal,
    opts.live ? sql`${t.kind} <> 'demo'` : undefined,
    opts.resortIds ? inArray(t.resortId, [...opts.resortIds]) : undefined,
  )
  const idList = await ids(
    db,
    sql`select id from (select ${t.id} as id, row_number() over (partition by ${t.resortId} order by ${t.localDate} desc, ${t.revision} desc, ${t.id} desc) as rn from ${t} where ${where}) where rn = 1`,
  )
  const rows = await byIds(idList, (c) => db.select().from(t).where(inArray(t.id, c)))
  return new Map(rows.map((r) => [r.resortId, r]))
}

/** Operations reports (all revisions) for resorts in a local-date window. */
export async function reportsBetween(
  db: Db,
  opts: { from: string; to: string; now: string; live: boolean; resortIds?: readonly string[] | null },
): Promise<OperationalReportRow[]> {
  const t = s.operationalReports
  return db
    .select()
    .from(t)
    .where(
      and(
        gte(t.localDate, opts.from),
        lte(t.localDate, opts.to),
        sql`(${t.reportedAt} is null or ${t.reportedAt} <= ${opts.now})`,
        notPersonal,
        opts.live ? sql`${t.kind} <> 'demo'` : undefined,
        opts.resortIds ? inArray(t.resortId, [...opts.resortIds]) : undefined,
      ),
    )
}

const providerRank = (p: string) => {
  const i = (PRIMARY_WEATHER_PROVIDERS as readonly string[]).indexOf(p)
  return i === -1 ? 99 : i
}

/**
 * Pick the run used as "the forecast" for a point from the latest ok run per provider: primary provider first,
 * then longer horizon, then most recent — the same rule the assessments job uses.
 */
export function pickPrimary(runs: readonly WeatherRunRow[]): WeatherRunRow | null {
  const sorted = [...runs].sort(
    (a, b) => providerRank(a.provider) - providerRank(b.provider) || (b.horizonDays ?? 0) - (a.horizonDays ?? 0) || b.fetchedAt.localeCompare(a.fetchedAt) || b.id - a.id,
  )
  return sorted[0] ?? null
}

/** Latest successful run per resort / point (primary provider preferred), fetched by `now`. */
export async function latestRuns(db: Db, now: string, live: boolean, resortIds: readonly string[] | null = null): Promise<Map<string, Map<string, WeatherRunRow>>> {
  const t = s.weatherRuns
  const where = and(
    eq(t.status, 'ok'),
    lte(t.fetchedAt, now),
    live ? sql`${t.kind} <> 'demo' and ${t.provider} <> 'demo'` : undefined,
    resortIds ? inArray(t.resortId, [...resortIds]) : undefined,
  )
  const idList = await ids(
    db,
    sql`select id from (select ${t.id} as id, row_number() over (partition by ${t.resortId}, ${t.pointKey}, ${t.provider} order by ${t.fetchedAt} desc, ${t.id} desc) as rn from ${t} where ${where}) where rn = 1`,
  )
  const rows = await byIds(idList, (c) => db.select().from(t).where(inArray(t.id, c)))
  const out = new Map<string, Map<string, WeatherRunRow>>()
  for (const [key, list] of groupBy(rows, (r) => `${r.resortId}|${r.pointKey}`)) {
    const [resortId, pointKey] = key.split('|')
    const best = pickPrimary(list)
    if (!best) continue
    const m = out.get(resortId) ?? new Map<string, WeatherRunRow>()
    m.set(pointKey, best)
    out.set(resortId, m)
  }
  return out
}

export function assessmentKey(resortId: string, date: string, mode: string) {
  return `${resortId}|${date}|${mode}`
}

/** Latest assessment per resort / date / mode computed by `now`. */
export async function latestAssessments(
  db: Db,
  opts: { dates: readonly string[]; modes?: readonly ScoringMode[] | null; now: string; live: boolean; resortIds?: readonly string[] | null },
): Promise<Map<string, ConditionsAssessmentRow>> {
  if (!opts.dates.length) return new Map()
  const t = s.conditionsAssessments
  const where = and(
    inArray(t.localDate, [...opts.dates]),
    lte(t.computedAt, opts.now),
    opts.modes ? inArray(t.mode, [...opts.modes]) : undefined,
    opts.live ? sql`${t.kind} <> 'demo'` : undefined,
    opts.resortIds ? inArray(t.resortId, [...opts.resortIds]) : undefined,
  )
  const idList = await ids(
    db,
    sql`select id from (select ${t.id} as id, row_number() over (partition by ${t.resortId}, ${t.localDate}, ${t.mode} order by ${t.computedAt} desc, ${t.id} desc) as rn from ${t} where ${where}) where rn = 1`,
  )
  const rows = await byIds(idList, (c) => db.select().from(t).where(inArray(t.id, c)))
  return new Map(rows.map((r) => [assessmentKey(r.resortId, r.localDate, r.mode), r]))
}

// ---------------------------------------------------------------------------
// Weather points

export function toHourly(p: typeof s.weatherPoints.$inferSelect): HourlyWeather {
  return {
    validTime: p.validTime,
    temperatureC: p.temperatureC,
    apparentTemperatureC: p.apparentTemperatureC,
    snowfallCm: p.snowfallCm,
    rainMm: p.rainMm,
    precipitationMm: p.precipitationMm,
    windKmh: p.windKmh,
    gustKmh: p.gustKmh,
    humidityPct: p.humidityPct,
    visibilityM: p.visibilityM,
    cloudCoverPct: p.cloudCoverPct,
    freezingLevelM: p.freezingLevelM,
    snowDepthM: p.snowDepthM,
    weatherCode: p.weatherCode,
    isDay: p.isDay,
  }
}

/** Canonical UTC ISO ('2027-01-15T14:00:00.000Z'), the format jobs store `validTime` in. */
export function iso(dt: DateTime): string {
  return dt.toUTC().toISO()!
}

export function floorHour(instant: string): string {
  return iso(DateTime.fromISO(instant, { zone: 'utc' }).startOf('hour'))
}

/** Hourly points of runs whose validTime lies in [from, to] (inclusive), grouped by run id, time-ordered. */
export async function pointsForRuns(db: Db, runIds: readonly number[], from: string, to: string): Promise<Map<number, HourlyWeather[]>> {
  const t = s.weatherPoints
  const rows = await byIds([...new Set(runIds)], (c) =>
    db
      .select()
      .from(t)
      .where(and(inArray(t.runId, c), gte(t.validTime, from), lte(t.validTime, to))),
  )
  const out = new Map<number, HourlyWeather[]>()
  for (const [runId, list] of groupBy(rows, (r) => r.runId)) {
    out.set(
      runId,
      list.sort((a, b) => (a.validTime < b.validTime ? -1 : a.validTime > b.validTime ? 1 : 0)).map(toHourly),
    )
  }
  return out
}

export interface SnowSum {
  /** Snowfall (cm) summed over hours with a value; null when no hour had one (unknown, not zero). */
  sumCm: number | null
  hoursWithValue: number
  expectedHours: number
  complete: boolean
}

/**
 * Forecast snowfall over the next `hours` from the start of the current hour, per run, computed in SQL. Whole hour
 * slots only, honouring each run's interval semantics (preceding-hour: a value stamped T covers (T−1h, T]).
 */
export async function forecastSnowSums(db: Db, runs: readonly WeatherRunRow[], now: string, windows: readonly number[]): Promise<Map<number, Record<number, SnowSum>>> {
  const out = new Map<number, Record<number, SnowSum>>()
  if (!runs.length || !windows.length) return out
  const from = floorHour(now)
  const fromDt = DateTime.fromISO(from, { zone: 'utc' })
  const t = s.weatherPoints
  const bySemantics = groupBy(runs, (r) => (runSemantics(r) === 'preceding-hour' ? 'preceding' : 'following'))
  for (const [sem, list] of bySemantics) {
    const cols = windows.map((h, i) => {
      const to = iso(fromDt.plus({ hours: h }))
      const inWin = sem === 'preceding' ? sql`${t.validTime} > ${from} and ${t.validTime} <= ${to}` : sql`${t.validTime} >= ${from} and ${t.validTime} < ${to}`
      return sql`sum(case when ${inWin} then ${t.snowfallCm} end) as ${sql.raw(`s${i}`)}, count(case when ${inWin} and ${t.snowfallCm} is not null then 1 end) as ${sql.raw(`n${i}`)}`
    })
    const maxTo = iso(fromDt.plus({ hours: Math.max(...windows) }))
    for (const c of chunks(list.map((r) => r.id))) {
      const rows = await db.all<Record<string, number | null>>(
        sql`select ${t.runId} as run_id, ${sql.join(cols, sql`, `)} from ${t} where ${inArray(t.runId, c)} and ${t.validTime} >= ${from} and ${t.validTime} <= ${maxTo} group by ${t.runId}`,
      )
      for (const row of rows) {
        const runId = Number(row.run_id)
        const rec: Record<number, SnowSum> = {}
        windows.forEach((h, i) => {
          const sum = row[`s${i}`]
          const n = Number(row[`n${i}`] ?? 0)
          rec[h] = { sumCm: sum === null || sum === undefined ? null : Math.round(Number(sum) * 10) / 10, hoursWithValue: n, expectedHours: h, complete: n >= h }
        })
        out.set(runId, rec)
      }
    }
  }
  for (const r of runs) {
    if (!out.has(r.id)) out.set(r.id, Object.fromEntries(windows.map((h) => [h, { sumCm: null, hoursWithValue: 0, expectedHours: h, complete: false }])))
  }
  return out
}

/** Season ids touched by local dates. */
export function seasonsOf(dates: readonly string[]): string[] {
  return [...new Set(dates.map(seasonIdFor))]
}
