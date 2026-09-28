/**
 * Weather refresh, official weather alerts and weather-run retention.
 *
 * - Every provider call becomes a `weather_runs` row: status 'ok' with its hourly `weather_points`, or status
 *   'error' with the error text (so Sources can show it). Earlier good runs are never deleted or rewritten.
 * - `validTime` is the provider's UTC stamp; `localDate` is the resort-local day of the hour the values describe,
 *   using the provider's interval semantics (Open-Meteo 'preceding-hour': a value stamped 00:00 local covers
 *   23:00–24:00 of the PREVIOUS day).
 * - Grid coordinates/elevation, units and model run time are stored exactly as the provider returned them;
 *   a missing model run time stays null (never inferred from the response time).
 */
import { and, desc, eq, inArray, lt, lte, notInArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { sourceRecords, weatherAlerts, weatherPoints, weatherRuns } from '@/lib/db/schema'
import type { ResortRow, WeatherRunRow } from '@/lib/db/rows'
import { addHours, localDateOf } from '@/lib/domain/time'
import { provenance, type Provenance } from '@/lib/domain/types'
import type {
  Capabilities,
  HourlyWeather,
  ProviderResult,
  SourceFetch,
  WeatherPointRequest,
  WeatherProvider,
  WeatherSeries,
} from '@/lib/providers/types'
import { STOPPED_NOTE, type ItemOutcome, type JobContext, type JobWorkResult } from './types'
import { canonicalInstant, chunk, daysBefore, errorMessage, selectResorts, truncate } from './util'

export type IntervalSemantics = WeatherSeries['intervalSemantics']

export const DEFAULT_PAST_DAYS = 3
export const DEFAULT_FORECAST_DAYS = 16
export const DEFAULT_WEATHER_RETENTION_DAYS = 14

/** Resort-local date of the hour a value describes, honouring the provider's interval semantics. */
export function weatherLocalDate(validTime: string, semantics: IntervalSemantics, tz: string): string {
  // preceding-hour: the value stamped T covers (T−1h, T]; attribute it to the day containing the hour's start.
  return localDateOf(semantics === 'preceding-hour' ? addHours(validTime, -1) : validTime, tz)
}

/** Weather request points for a resort; falls back to the resort centre at base elevation when none are curated. */
export function weatherRequests(resort: ResortRow): WeatherPointRequest[] {
  const defs = resort.weatherPoints?.length
    ? resort.weatherPoints
    : [{ key: 'base', label: 'Base', lat: resort.lat, lon: resort.lon, elevationM: resort.baseElevationM }]
  return defs.map((p) => ({
    resortId: resort.id,
    pointKey: p.key,
    lat: p.lat,
    lon: p.lon,
    elevationM: p.elevationM ?? null,
    timezone: resort.timezone,
    country: resort.country,
  }))
}

// ---------------------------------------------------------------------------
// Persistence

export interface PersistedRun {
  runId: number
  points: number
  /** Records dropped because their validTime could not be parsed. */
  invalidTimes: number
  /** Records sharing an hour stamp with a later record (the later one wins). */
  duplicates: number
}

export async function persistWeatherSeries(
  db: Db,
  args: {
    resort: Pick<ResortRow, 'id' | 'timezone'>
    request: WeatherPointRequest
    providerId: string
    series: WeatherSeries
    provenance: Provenance
    capabilities: Capabilities
    now: string
  },
): Promise<PersistedRun> {
  const { resort, request, series, capabilities, now } = args
  const tz = resort.timezone
  const byTime = new Map<string, HourlyWeather>()
  let invalidTimes = 0
  let duplicates = 0
  for (const h of series.hourly) {
    const t = canonicalInstant(h.validTime)
    if (!t) {
      invalidTimes++
      continue
    }
    if (byTime.has(t)) duplicates++
    byTime.set(t, { ...h, validTime: t })
  }
  const note = args.provenance.note ?? (capabilities.limitations.length ? capabilities.limitations.join(' ') : null)
  const prov: Provenance = { ...args.provenance, kind: series.kind, fetchedAt: args.provenance.fetchedAt ?? now, note }

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(weatherRuns)
      .values({
        resortId: resort.id,
        pointKey: request.pointKey,
        provider: args.providerId,
        model: series.model,
        kind: series.kind,
        requestedLat: series.requested?.lat ?? request.lat,
        requestedLon: series.requested?.lon ?? request.lon,
        requestedElevationM: series.requested ? series.requested.elevationM : request.elevationM,
        gridLat: series.grid.lat,
        gridLon: series.grid.lon,
        gridElevationM: series.grid.elevationM,
        fetchedAt: prov.fetchedAt!,
        modelRunAt: series.modelRunAt,
        timezone: tz,
        horizonDays: series.horizonDays,
        variables: capabilities.supplied,
        units: series.units,
        intervalSemantics: series.intervalSemantics,
        status: 'ok',
        error: null,
        prov,
      })
      .returning({ id: weatherRuns.id })
    const rows = [...byTime.values()].map((h) => ({
      runId: run.id,
      validTime: h.validTime,
      localDate: weatherLocalDate(h.validTime, series.intervalSemantics, tz),
      temperatureC: h.temperatureC,
      apparentTemperatureC: h.apparentTemperatureC,
      snowfallCm: h.snowfallCm,
      rainMm: h.rainMm,
      precipitationMm: h.precipitationMm,
      windKmh: h.windKmh,
      gustKmh: h.gustKmh,
      humidityPct: h.humidityPct,
      visibilityM: h.visibilityM,
      cloudCoverPct: h.cloudCoverPct,
      freezingLevelM: h.freezingLevelM,
      snowDepthM: h.snowDepthM,
      weatherCode: h.weatherCode,
      isDay: h.isDay,
    }))
    for (const part of chunk(rows, 200)) await tx.insert(weatherPoints).values(part)
    return { runId: run.id, points: rows.length, invalidTimes, duplicates }
  })
}

/** An error row so Sources can show the failure; last good runs are untouched. */
export async function recordWeatherFailure(
  db: Db,
  args: { resort: Pick<ResortRow, 'id' | 'timezone'>; request: WeatherPointRequest; provider: Pick<WeatherProvider, 'id' | 'label'>; error: string; sourceUrl: string | null; now: string },
): Promise<number> {
  const [row] = await db
    .insert(weatherRuns)
    .values({
      resortId: args.resort.id,
      pointKey: args.request.pointKey,
      provider: args.provider.id,
      model: null,
      kind: args.provider.id === 'demo' ? 'demo' : 'modeled',
      requestedLat: args.request.lat,
      requestedLon: args.request.lon,
      requestedElevationM: args.request.elevationM,
      gridLat: null,
      gridLon: null,
      gridElevationM: null,
      fetchedAt: args.now,
      modelRunAt: null,
      timezone: args.resort.timezone,
      horizonDays: null,
      variables: [],
      units: {},
      intervalSemantics: null,
      status: 'error',
      error: truncate(args.error, 1000),
      prov: provenance({ kind: 'modeled', provider: args.provider.label, sourceUrl: args.sourceUrl, note: 'Fetch failed; the last good run is kept' }),
    })
    .returning({ id: weatherRuns.id })
  return row.id
}

/** Log each HTTP fetch an adapter made (debugging, freshness, change detection). */
export async function recordFetches(
  db: Db,
  args: { adapter: string; resortId: string | null; result: ProviderResult<unknown>; adapterVersion?: string | null; extract?: unknown },
): Promise<number[]> {
  const { result } = args
  const ids: number[] = []
  const failed = !result.ok
  const parserErrors = !result.ok && (result.errorKind === 'parse' || result.errorKind === 'schema-changed') ? [result.error] : null
  for (const f of result.fetches as SourceFetch[]) {
    // A cached response is not a new retrieval (its fetchedAt is the original one) — don't log it twice.
    if (f.fromCache) continue
    const httpOk = f.ok ?? (f.httpStatus === null || (f.httpStatus >= 200 && f.httpStatus < 300))
    const fetchError = f.ok === false ? (f.error ?? null) : null
    const [row] = await db
      .insert(sourceRecords)
      .values({
        adapter: args.adapter,
        adapterVersion: args.adapterVersion ?? null,
        resortId: args.resortId,
        url: f.url,
        fetchedAt: f.fetchedAt,
        httpStatus: f.httpStatus,
        ok: !failed && httpOk,
        contentHash: f.contentHash,
        extract: args.extract !== undefined ? args.extract : (f.extract ?? null),
        error: fetchError ? truncate(fetchError, 1000) : failed ? truncate(`${result.errorKind}: ${result.error}`, 1000) : null,
        parserErrors,
      })
      .returning({ id: sourceRecords.id })
    ids.push(row.id)
  }
  return ids
}

async function callSafely<T>(fn: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
  try {
    return await fn()
  } catch (e) {
    return { ok: false, error: errorMessage(e), errorKind: 'network', retriable: true, fetches: [] }
  }
}

// ---------------------------------------------------------------------------
// Jobs

export interface WeatherJobOptions {
  resortIds?: readonly string[] | null
  pastDays?: number
  forecastDays?: number
}

/** Fetch and persist forecasts for every resort weather point from every supporting provider. */
export async function refreshWeather(ctx: JobContext, opts: WeatherJobOptions = {}): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: live weather is never fetched into demo data'] }
  if (deps.weatherProviders.length === 0) return { items: [], notes: ['No weather provider configured'] }
  const ids = opts.resortIds ?? (ctx.target ? [ctx.target] : null)
  const resorts = await selectResorts(db, ids)
  const items: ItemOutcome[] = []
  for (const resort of resorts) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    for (const request of weatherRequests(resort)) {
      for (const provider of deps.weatherProviders) {
        const key = `${resort.id}:${request.pointKey}:${provider.id}`
        try {
          if (!provider.supports(request)) {
            items.push({ key, target: resort.id, ok: true, skipped: true, written: 0 })
            continue
          }
          const result = await callSafely(() =>
            provider.fetchForecast(request, { pastDays: opts.pastDays ?? DEFAULT_PAST_DAYS, forecastDays: opts.forecastDays ?? DEFAULT_FORECAST_DAYS }),
          )
          await recordFetches(db, { adapter: provider.id, resortId: resort.id, result })
          if (result.ok) {
            const saved = await persistWeatherSeries(db, {
              resort,
              request,
              providerId: provider.id,
              series: result.data,
              provenance: result.provenance,
              capabilities: result.capabilities,
              now,
            })
            items.push({ key, target: resort.id, ok: true, written: saved.points + 1 })
          } else {
            const error = `${result.errorKind}: ${result.error}`
            await recordWeatherFailure(db, { resort, request, provider, error, sourceUrl: result.fetches[0]?.url ?? null, now })
            items.push({ key, target: resort.id, ok: false, written: 0, error })
          }
        } catch (e) {
          // Per-source isolation: a DB or adapter bug for one point never aborts the others.
          items.push({ key, target: resort.id, ok: false, written: 0, error: errorMessage(e) })
        }
      }
    }
  }
  return { items }
}

/** Official warnings (e.g. NWS) → weather_alerts. Alerts no longer active and expired alerts are removed. */
export async function refreshOfficialAlerts(ctx: JobContext): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: live alerts are never fetched into demo data'] }
  const provider = deps.alertsProvider
  const resorts = await selectResorts(db, ctx.target ? [ctx.target] : null)
  const items: ItemOutcome[] = []
  for (const resort of resorts) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    const key = `${resort.id}:${provider?.id ?? 'none'}`
    try {
      // Expired alerts go regardless of whether this fetch works.
      await db.delete(weatherAlerts).where(and(eq(weatherAlerts.resortId, resort.id), lte(weatherAlerts.ends, now)))
      const req = { lat: resort.lat, lon: resort.lon, country: resort.country }
      if (!provider || !provider.supports(req)) {
        items.push({ key, target: resort.id, ok: true, skipped: true, written: 0 })
        continue
      }
      const result = await callSafely(() => provider.fetchActiveAlerts(req))
      await recordFetches(db, { adapter: provider.id, resortId: resort.id, result })
      if (!result.ok) {
        items.push({ key, target: resort.id, ok: false, written: 0, error: `${result.errorKind}: ${result.error}` })
        continue
      }
      // weather_alerts.id is the primary key; one provider alert can cover several resorts, so scope it.
      // Instants are canonicalised so string comparisons (expiry) are correct whatever offset the issuer used.
      const norm = (s: string | null) => (s ? (canonicalInstant(s) ?? s) : null)
      const active = result.data.map((a) => ({ ...a, onset: norm(a.onset), ends: norm(a.ends) })).filter((a) => !a.ends || a.ends > now)
      const ids = active.map((a) => `${resort.id}|${a.id}`)
      for (const a of active) {
        const row = {
          id: `${resort.id}|${a.id}`,
          resortId: resort.id,
          provider: provider.id,
          event: a.event,
          headline: a.headline,
          severity: a.severity,
          onset: a.onset,
          ends: a.ends,
          url: a.url,
          fetchedAt: now,
        }
        await db.insert(weatherAlerts).values(row).onConflictDoUpdate({ target: weatherAlerts.id, set: row })
      }
      const stale = eq(weatherAlerts.resortId, resort.id)
      await db.delete(weatherAlerts).where(ids.length ? and(stale, notInArray(weatherAlerts.id, ids)) : stale)
      items.push({ key, target: resort.id, ok: true, written: active.length })
    } catch (e) {
      items.push({ key, target: resort.id, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  return { items }
}

// ---------------------------------------------------------------------------
// Retention

export interface PruneResult {
  runsDeleted: number
  runsKept: number
}

/**
 * Keep every run from the last `keepDays` days. Older runs: keep the first successful run per
 * resort / point / provider / resort-local day (forecasts made before their valid time stay available for
 * verification); delete the rest, including old error rows. Rows are only ever deleted — never rewritten.
 */
export async function pruneWeatherRuns(db: Db, now: string, keepDays = DEFAULT_WEATHER_RETENTION_DAYS): Promise<PruneResult> {
  const cutoff = daysBefore(now, keepDays)
  const old = await db
    .select({
      id: weatherRuns.id,
      resortId: weatherRuns.resortId,
      pointKey: weatherRuns.pointKey,
      provider: weatherRuns.provider,
      fetchedAt: weatherRuns.fetchedAt,
      timezone: weatherRuns.timezone,
      status: weatherRuns.status,
    })
    .from(weatherRuns)
    .where(lt(weatherRuns.fetchedAt, cutoff))
  const firstOfDay = new Map<string, { id: number; fetchedAt: string }>()
  for (const r of old) {
    if (r.status !== 'ok') continue
    const k = `${r.resortId}|${r.pointKey}|${r.provider}|${localDateOf(r.fetchedAt, r.timezone)}`
    const cur = firstOfDay.get(k)
    if (!cur || r.fetchedAt < cur.fetchedAt || (r.fetchedAt === cur.fetchedAt && r.id < cur.id)) firstOfDay.set(k, { id: r.id, fetchedAt: r.fetchedAt })
  }
  const keep = new Set([...firstOfDay.values()].map((v) => v.id))
  const doomed = old.filter((r) => !keep.has(r.id)).map((r) => r.id)
  for (const ids of chunk(doomed, 400)) {
    await db.delete(weatherPoints).where(inArray(weatherPoints.runId, ids))
    await db.delete(weatherRuns).where(inArray(weatherRuns.id, ids))
  }
  return { runsDeleted: doomed.length, runsKept: keep.size }
}

// ---------------------------------------------------------------------------
// Reading back

export interface StoredSeries {
  run: WeatherRunRow
  hourly: HourlyWeather[]
  semantics: IntervalSemantics
}

/**
 * Interval semantics of a stored run. Every run this job writes records it; rows written without it (e.g. by an
 * Open-Meteo-shaped generator) are read with Open-Meteo's documented 'preceding-hour' convention.
 */
export function runSemantics(run: Pick<WeatherRunRow, 'intervalSemantics'>): IntervalSemantics {
  return run.intervalSemantics ?? 'preceding-hour'
}

export async function loadRunSeries(db: Db, run: WeatherRunRow): Promise<StoredSeries> {
  const pts = await db.select().from(weatherPoints).where(eq(weatherPoints.runId, run.id)).orderBy(weatherPoints.validTime)
  const hourly: HourlyWeather[] = pts.map((p) => ({
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
  }))
  return { run, hourly, semantics: runSemantics(run) }
}

/** Latest successful run per point key and provider for a resort (newest first within each group). */
export async function latestOkRuns(db: Db, resortId: string): Promise<Map<string, WeatherRunRow>> {
  const rows = await db
    .select()
    .from(weatherRuns)
    .where(and(eq(weatherRuns.resortId, resortId), eq(weatherRuns.status, 'ok')))
    .orderBy(desc(weatherRuns.fetchedAt), desc(weatherRuns.id))
    .limit(200)
  const out = new Map<string, WeatherRunRow>()
  for (const r of rows) {
    const k = `${r.pointKey}|${r.provider}`
    if (!out.has(k)) out.set(k, r)
  }
  return out
}
