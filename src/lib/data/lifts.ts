/**
 * Lifts & runs for the resort page: the newest SUCCESSFULLY loaded OpenStreetMap extract of a resort (source_records
 * of adapter 'osm-overpass', written by the 'osm' job), grouped for display in the resort's own difficulty convention;
 * how the latest attempt went (refresh_runs of job 'osm' for the resort); and whether the resort loads on schedule
 * (a favourite, or in an upcoming trip) or on demand.
 *
 * Community-mapped data, labelled as such, never live status. A failed attempt never hides the last good list. Demo mode
 * reads nothing: OpenStreetMap is never fetched into the demo database.
 *
 * Line geometry (for the lifts-and-runs map) comes only from OpenStreetMap snapshots bundled with the app
 * (src/assets/osm): the stored extract keeps no geometry. Resorts without a snapshot get no drawn lines.
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
import { greatCircleKm } from '@/lib/domain/geo'
import { LIFT_TYPES, PISTE_DIFFICULTIES, difficultyStyle as styleOf, liftKindText, type LiftType, type PisteShape, type PisteTone, type RunDifficulty } from '@/lib/domain/lifts'
import greekPeakOsm from '@/assets/osm/greek-peak.json'
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

// ---------------------------------------------------------------------------------------------------------------------
// Bundled geometry (map lines)

/** One mapped way, ready to draw: a run in the resort's own sign (shape + words, never colour alone) or a lift. */
export interface MappedLine {
  id: string
  kind: 'run' | 'lift'
  name: string | null
  /** Run: 'Black diamond'; lift: '4-seat chairlift'. */
  label: string
  /** Run sign (lifts have none). */
  sign: { key: string; shape: PisteShape; tone: PisteTone; meaning: string } | null
  /** Along the mapped line (map distance), metres. */
  lengthM: number
  /** [lon, lat] pairs. */
  coords: [number, number][]
}

export interface MappedGeometry {
  /** When the snapshot was taken from OpenStreetMap. */
  fetchedAt: string
  lines: MappedLine[]
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
  prov: Provenance
}

interface SnapshotElement {
  tags?: Record<string, string | undefined>
  geometry: { lat: number; lon: number }[]
}
interface Snapshot {
  fetched: string
  elements: SnapshotElement[]
}

const SNAPSHOTS: Record<string, Snapshot> = { 'greek-peak': greekPeakOsm as unknown as Snapshot }

const lineLength = (coords: [number, number][]) =>
  coords.reduce((m, c, i) => (i ? m + greatCircleKm({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: c[0], lat: c[1] }) * 1000 : 0), 0)

/** Lines of the OpenStreetMap snapshot bundled for this resort, or null when there is none. */
export function bundledGeometry(resortId: string, country: string): MappedGeometry | null {
  const snap = SNAPSHOTS[resortId]
  if (!snap) return null
  const convention = difficultyConvention(country)
  const lines: MappedLine[] = []
  let w = 180
  let so = 90
  let e = -180
  let n = -90
  snap.elements.forEach((el, i) => {
    const t = el.tags ?? {}
    const coords = el.geometry.map((g) => [g.lon, g.lat] as [number, number])
    if (coords.length < 2) return
    for (const [lon, lat] of coords) {
      w = Math.min(w, lon)
      e = Math.max(e, lon)
      so = Math.min(so, lat)
      n = Math.max(n, lat)
    }
    const lengthM = Math.round(lineLength(coords))
    if (t.aerialway) {
      if (!(LIFT_TYPES as readonly string[]).includes(t.aerialway)) return
      const occ = Number(t['aerialway:occupancy'])
      const label = liftKindText({ type: t.aerialway as LiftType, occupancy: Number.isFinite(occ) && occ > 0 ? occ : null })
      lines.push({ id: `l${i}`, kind: 'lift', name: t.name ?? t.ref ?? null, label, sign: null, lengthM, coords })
      return
    }
    const raw = t['piste:difficulty']
    const diff: RunDifficulty = raw && (PISTE_DIFFICULTIES as readonly string[]).includes(raw) ? (raw as RunDifficulty) : 'unknown'
    const st = styleOf(diff, convention)
    lines.push({
      id: `r${i}`,
      kind: 'run',
      name: t.name ?? t['piste:name'] ?? null,
      label: st.label,
      sign: { key: st.key, shape: st.shape, tone: st.tone, meaning: st.meaning },
      lengthM,
      coords,
    })
  })
  return {
    fetchedAt: snap.fetched,
    lines,
    bbox: [w, so, e, n],
    prov: provenance({
      kind: 'manual',
      provider: OSM_PROVIDER,
      sourceUrl: osmMapUrl((so + n) / 2, (w + e) / 2),
      publishedAt: null,
      fetchedAt: snap.fetched,
      verification: 'unverified',
      note: `${OSM_NOTE}. Snapshot bundled with Piste.`,
    }),
  }
}
