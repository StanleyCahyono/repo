/**
 * Lifts & runs from OpenStreetMap (job 'osm').
 *
 * - Scheduled weekly (`Cadences.osmMin`) for favourites and resorts in upcoming trips, one task per resort (so a new
 *   favourite loads at the next scheduler tick); on demand for any resort through POST /api/refresh
 *   `{ job: 'osm', target }`, with the usual manual cooldown. Never against the demo database.
 * - Each attempt writes ONE source_records row (adapter 'osm-overpass', url = the Overpass endpoint), as official
 *   report ingestion does: on success the compact extract `{ skiArea, requests }` (no geometry), on failure the error.
 *   Readers take the newest successful row, so a failed attempt never replaces the last good list, and retention
 *   (maintenance.ts) keeps the newest row and the newest successful row per adapter / resort / url whatever their age.
 * - A refusal without a request (Overpass asked Piste to slow down) is a failed item that writes no fetch record —
 *   nothing was fetched — and the remaining resorts of that run wait for their next turn.
 */
import { and, eq, gte, inArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { favorites, sourceRecords, tripItems, trips } from '@/lib/db/schema'
import type { ResortRow } from '@/lib/db/rows'
import { SKI_AREA_EXTRACT_VERSION, type SkiAreaExtract } from '@/lib/domain/lifts'
import { addDays } from '@/lib/domain/time'
import type { StoredSkiArea } from '@/lib/providers/osm/extract'
import type { ProviderResult, SkiAreaProvider } from '@/lib/providers/types'
import { STOPPED_NOTE, type ItemOutcome, type JobContext, type JobWorkResult } from './types'
import { errorMessage, hashJson, selectResorts, truncate } from './util'

/**
 * Resorts whose lifts and runs load on schedule: favourites (in their order), then resorts with a resort day in an
 * upcoming trip (draft or booked, ending no earlier than yesterday — trip dates are local days, so a day of slack keeps
 * a trip that ends today anywhere in the world).
 */
export async function osmTargets(db: Db, now: string): Promise<string[]> {
  const favs = await db.select({ id: favorites.resortId, order: favorites.sortOrder }).from(favorites)
  const inTrips = await db
    .selectDistinct({ id: tripItems.refId })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.type, 'resort-day'), inArray(trips.status, ['draft', 'booked']), gte(trips.endDate, addDays(now.slice(0, 10), -1))))
  const ids = [...favs.sort((a, b) => a.order - b.order).map((f) => f.id), ...inTrips.map((t) => t.id).filter((x): x is string => !!x).sort()]
  return [...new Set(ids)]
}

/** Where to look: the resort's weather points (base and summit), else its location. */
export function searchPoints(r: Pick<ResortRow, 'lat' | 'lon' | 'weatherPoints'>): { lat: number; lon: number }[] {
  const pts = (r.weatherPoints ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => ({ lat: p.lat, lon: p.lon }))
  return pts.length ? pts : [{ lat: r.lat, lon: r.lon }]
}

/** Store one attempt (see module comment). Returns the source_records id, or null when nothing was requested. */
export async function recordSkiArea(
  db: Db,
  a: { provider: Pick<SkiAreaProvider, 'id' | 'endpoint'>; resortId: string; result: ProviderResult<SkiAreaExtract>; now: string },
): Promise<number | null> {
  const { result } = a
  const last = result.fetches[result.fetches.length - 1]
  if (!last) return null
  const base = {
    adapter: a.provider.id,
    adapterVersion: `extract-v${SKI_AREA_EXTRACT_VERSION}`,
    resortId: a.resortId,
    url: last.url || a.provider.endpoint,
    fetchedAt: last.fetchedAt || a.now,
    httpStatus: last.httpStatus,
  }
  if (!result.ok) {
    const parserErrors = result.errorKind === 'parse' || result.errorKind === 'schema-changed' ? [result.error] : null
    const [row] = await db
      .insert(sourceRecords)
      .values({ ...base, ok: false, contentHash: last.contentHash, extract: null, error: truncate(`${result.errorKind}: ${result.error}`, 1000), parserErrors })
      .returning({ id: sourceRecords.id })
    return row.id
  }
  const extract: StoredSkiArea = { skiArea: result.data, requests: result.fetches.length }
  // The content hash ignores the server's data timestamp: the same lifts and runs hash the same.
  const [row] = await db
    .insert(sourceRecords)
    .values({ ...base, ok: true, contentHash: hashJson({ ...result.data, osmTimestamp: null }), extract, error: null, parserErrors: null })
    .returning({ id: sourceRecords.id })
  return row.id
}

/** Load lifts and runs for `ctx.target`, or for every scheduled resort (favourites and upcoming trips). */
export async function refreshOsm(ctx: JobContext): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: OpenStreetMap is never fetched into demo data'] }
  const provider = deps.osmProvider
  if (!provider) return { items: [], notes: ['The OpenStreetMap lifts & runs connector is turned off'] }
  const ids = ctx.target ? [ctx.target] : await osmTargets(db, now)
  if (!ids.length) return { items: [], notes: ['No favourites or upcoming trips — lifts & runs load on demand from a resort page'] }
  const resorts = await selectResorts(db, ids)
  if (!resorts.length) return { items: ids.map((id) => ({ key: `${id}:${provider.id}`, target: id, ok: true, skipped: true, written: 0, error: 'Resort not in catalog' })) }
  const items: ItemOutcome[] = []
  for (const [i, resort] of resorts.entries()) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    const key = `${resort.id}:${provider.id}`
    let result: ProviderResult<SkiAreaExtract>
    try {
      result = await provider.fetchSkiArea({ resortId: resort.id, names: [resort.name, resort.shortName], country: resort.country, points: searchPoints(resort) })
    } catch (e) {
      result = { ok: false, error: errorMessage(e), errorKind: 'network', retriable: true, fetches: [] }
    }
    try {
      await recordSkiArea(db, { provider, resortId: resort.id, result, now })
    } catch (e) {
      items.push({ key, target: resort.id, ok: false, written: 0, error: `Could not store the result: ${errorMessage(e)}` })
      continue
    }
    if (result.ok) items.push({ key, target: resort.id, ok: true, written: 1 })
    else items.push({ key, target: resort.id, ok: false, written: 0, error: truncate(`${result.errorKind}: ${result.error}`, 500) })
    if (!result.ok && result.errorKind === 'rate-limited') {
      for (const r of resorts.slice(i + 1)) {
        items.push({ key: `${r.id}:${provider.id}`, target: r.id, ok: true, skipped: true, written: 0, error: 'Not tried: the Overpass API asked Piste to slow down' })
      }
      break
    }
  }
  return { items }
}
