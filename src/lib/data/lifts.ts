/**
 * Lifts & runs for the resort page: the newest SUCCESSFULLY loaded OpenStreetMap extract of a resort (source_records
 * of adapter 'osm-overpass', written by the 'osm' job), grouped for display in the resort's own difficulty convention;
 * how the latest attempt went (refresh_runs of job 'osm' for the resort); and whether the resort loads on schedule
 * (a favourite, or in an upcoming trip) or on demand.
 *
 * Community-mapped data, labelled as such, never live status. A failed attempt never hides the last good list. Demo mode
 * reads nothing: OpenStreetMap is never fetched into the demo database.
 */
import 'server-only'
import { and, desc, eq, lte, ne } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import {
  CONVENTION_LABEL,
  OSM_NOTE,
  OSM_PROVIDER,
  conventionLegend,
  difficultyConvention,
  groupLifts,
  groupRuns,
  liftCountsText,
  osmMapUrl,
  osmUrl,
  runCountsText,
  skiAreaTotals,
  type DifficultyConvention,
  type DifficultyStyle,
  type LiftGroup,
  type RunGroup,
  type SkiAreaTotals,
} from '@/lib/domain/lifts'
import { provenance, type Provenance } from '@/lib/domain/types'
import { isLive, type DataCtx } from './core'
import { OSM_ADAPTER_ID, osmTargets, providerStatus, readSkiAreaExtract, type ConnectorState } from './deps'

export interface LiftsRunsAttempt {
  at: string
  outcome: 'ok' | 'failed' | 'running'
  /** This resort's own error when the attempt failed. */
  error: string | null
  trigger: 'schedule' | 'manual' | 'startup'
}

export interface LiftsRunsLoaded {
  /** When Piste loaded it. */
  fetchedAt: string
  /** When the OpenStreetMap data the server answered from was last updated. */
  osmTimestamp: string | null
  method: 'area' | 'bbox'
  /** The OpenStreetMap ski areas searched (named or not), with their pages. */
  areas: { name: string | null; url: string }[]
  liftGroups: LiftGroup[]
  runGroups: RunGroup[]
  /** '2 gondolas · 9 chairlifts · 4 surface lifts' */
  liftCounts: string
  /** '12 black diamond · 3 double black diamond' (named runs) */
  runCounts: string
  totals: SkiAreaTotals
  /** Pistes mapped only as outlines: not listed. */
  areaPistes: number
  mapUrl: string
  prov: Provenance
}

export interface LiftsRunsView {
  demo: boolean
  connector: { id: string; state: ConnectorState }
  /** Loads on schedule (a favourite, or in an upcoming trip); otherwise on demand only. */
  scheduled: boolean
  convention: DifficultyConvention
  conventionLabel: string
  legend: DifficultyStyle[]
  loaded: LiftsRunsLoaded | null
  lastAttempt: LiftsRunsAttempt | null
}

export async function getLiftsRuns(ctx: DataCtx, resort: { id: string; country: string; lat: number; lon: number }): Promise<LiftsRunsView> {
  const { db, now } = ctx
  const connector = providerStatus().find((c) => c.id === OSM_ADAPTER_ID)
  const convention = difficultyConvention(resort.country)
  const base = {
    connector: { id: OSM_ADAPTER_ID, state: connector?.state ?? ('disabled' as ConnectorState) },
    convention,
    conventionLabel: CONVENTION_LABEL[convention],
    legend: conventionLegend(convention),
  }
  if (!isLive(ctx)) return { ...base, demo: true, scheduled: false, loaded: null, lastAttempt: null }

  const sr = s.sourceRecords
  const rr = s.refreshRuns
  const [records, runs, scheduledIds] = await Promise.all([
    db
      .select()
      .from(sr)
      .where(and(eq(sr.adapter, OSM_ADAPTER_ID), eq(sr.resortId, resort.id), eq(sr.ok, true), lte(sr.fetchedAt, now)))
      .orderBy(desc(sr.fetchedAt), desc(sr.id))
      .limit(3),
    db
      .select()
      .from(rr)
      .where(and(eq(rr.job, 'osm'), eq(rr.target, resort.id), ne(rr.status, 'skipped'), lte(rr.startedAt, now)))
      .orderBy(desc(rr.startedAt), desc(rr.id))
      .limit(1),
    osmTargets(db, now),
  ])

  let loaded: LiftsRunsLoaded | null = null
  for (const rec of records) {
    const e = readSkiAreaExtract(rec.extract)
    if (!e) continue
    const areas = e.areas.map((a) => ({ name: a.name, url: osmUrl(a.osm) }))
    const centre = e.bbox ? { lat: (e.bbox[0] + e.bbox[2]) / 2, lon: (e.bbox[1] + e.bbox[3]) / 2 } : { lat: resort.lat, lon: resort.lon }
    const liftGroups = groupLifts(e.lifts)
    const runGroups = groupRuns(e, convention)
    loaded = {
      fetchedAt: rec.fetchedAt,
      osmTimestamp: e.osmTimestamp,
      method: e.method,
      areas,
      liftGroups,
      runGroups,
      liftCounts: liftCountsText(liftGroups),
      runCounts: runCountsText(runGroups),
      totals: skiAreaTotals(e),
      areaPistes: e.areaPistes,
      mapUrl: osmMapUrl(centre.lat, centre.lon),
      prov: provenance({
        kind: 'manual',
        provider: OSM_PROVIDER,
        sourceUrl: areas[0]?.url ?? osmMapUrl(centre.lat, centre.lon),
        publishedAt: e.osmTimestamp,
        fetchedAt: rec.fetchedAt,
        verification: 'unverified',
        note: OSM_NOTE,
      }),
    }
    break
  }

  const run = runs[0]
  let lastAttempt: LiftsRunsAttempt | null = null
  if (run) {
    const own = (run.details?.items ?? []).find((i) => i.target === resort.id && !i.skipped)
    const failed = run.status === 'error' || run.status === 'partial' || (own ? !own.ok : false)
    lastAttempt = {
      at: run.finishedAt ?? run.startedAt,
      outcome: run.status === 'running' ? 'running' : failed ? 'failed' : 'ok',
      error: failed ? (own?.error ?? run.error ?? null)?.replace(/^[a-z-]+:\s*/i, '') ?? null : null,
      trigger: run.trigger,
    }
  }

  return { ...base, demo: false, scheduled: scheduledIds.includes(resort.id), loaded, lastAttempt }
}
