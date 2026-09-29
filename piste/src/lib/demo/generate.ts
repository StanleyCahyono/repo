/**
 * Demo data generator for the ISOLATED demo database (data/piste-demo.db). Never used on the live database.
 *
 * `generateDemoData(db)` builds, deterministically and in a few seconds:
 * 1. the real catalog (same facts as live), user preferences and `tracking.start` = 2026-12-01;
 * 2. synthetic hourly weather: one run per day (11:00Z) for the favourites and six others, plus a latest run at
 *    DEMO_NOW for every simulated resort (past 2 days + 16 days ahead);
 * 3. simulated operations — announcements, status statements, daily reports with revisions and gaps — replayed
 *    through the jobs' status/report helpers;
 * 4. personal records (pass + linked expense, pass days, trips, ski-day logs, skills, lessons, alerts, FX, rating);
 * 5. conditions assessments computed with only the evidence that existed at the time.
 * Every simulated row is kind 'demo' / demo provenance ('Piste demo generator', note 'Simulated…'), so a leak into
 * live data would be visible. Nothing simulated is dated before the tracking start (the pass purchase date is a
 * personal record by design).
 *
 * `ensureDemoData(db)` runs it once (no-op when `demo.generatedAt` is set) and refuses a database that already holds
 * non-demo data.
 */
import { count, eq, getTableName, inArray, is, sql } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type { OperationalReportRow, ResortRow } from '@/lib/db/rows'
import { getMeta, loadCatalog, seedCatalog, setMeta } from '@/lib/catalog/seed'
import { defaultPreferences } from '@/lib/domain/defaults'
import { dateRange } from '@/lib/domain/time'
import { weatherLocalDate } from '@/lib/jobs/weather'
import { assessResortTimeline, type ResortTimeline, type StoredRun } from './assess'
import { bulkInsert } from './bulk'
import { simulateOperations, type OperationsResult } from './operations'
import { seedPersonalRecords } from './personal'
import { simulateReports, terrainTotals } from './reports'
import {
  DEMO_MODEL,
  DEMO_NOW,
  DEMO_RESORTS,
  DEMO_TODAY,
  DEMO_VERSION,
  DEMO_WEATHER_PROVIDER,
  LAST_DATE,
  META_GENERATED,
  META_MARKER,
  META_TRACKING,
  META_VERSION,
  TRACKING_START,
  demoProv,
  type DemoResortProfile,
} from './scenario'
import { DEMO_UNITS, DEMO_VARIABLES, buildResortTruth, forecastRun, type ResortTruth } from './weather'

export interface DemoSummary {
  version: string
  now: string
  trackingStart: string
  simulatedResorts: string[]
  /** Catalog resorts left without any simulated data (their status stays unknown). */
  untouchedResorts: string[]
  counts: Record<string, number>
  timingsMs: Record<string, number>
  totalMs: number
}

export interface GenerateOptions {
  log?: (line: string) => void
}

/** When the demo user "set up" Piste: the morning tracking started. */
const SETUP_AT = `${TRACKING_START}T13:00:00.000Z`

const DAILY_RUN_UTC = 'T11:00:00.000Z'

// ---------------------------------------------------------------------------
// Safety

const allTables = (): SQLiteTable[] => (Object.values(s) as unknown[]).filter((t): t is SQLiteTable => is(t, SQLiteTable))

async function rowCount(db: Db, table: SQLiteTable): Promise<number> {
  const [r] = await db.select({ n: count() }).from(table)
  return Number(r?.n ?? 0)
}

/**
 * Make sure `db` may receive demo data. A database without the demo marker must hold no catalog, collected or
 * personal data (the live database never qualifies). A marked demo database from an interrupted run is wiped.
 */
async function prepareDatabase(db: Db): Promise<'fresh' | 'reset'> {
  const marker = await getMeta(db, META_MARKER)
  if (!marker) {
    const guarded = [s.resorts, s.weatherRuns, s.operationalReports, s.conditionsAssessments, s.statusEvents, s.trips, s.passOwnership, s.expenses, s.skiDayLogs]
    for (const t of guarded) {
      if ((await rowCount(db, t)) > 0) {
        throw new Error(`Refusing to write demo data: table ${getTableName(t)} already holds rows and this is not a demo database.`)
      }
    }
    if (await getMeta(db, 'catalog.seededAt')) throw new Error('Refusing to write demo data: this database was seeded as a live database.')
    return 'fresh'
  }
  await db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    for (const t of allTables()) await db.delete(t)
    await db.run(sql`DELETE FROM sqlite_sequence`).catch(() => undefined)
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`)
  }
  return 'reset'
}

// ---------------------------------------------------------------------------
// Weather

type PointInsert = typeof s.weatherPoints.$inferInsert

async function writeWeather(db: Db, resort: ResortRow, truth: ResortTruth, profile: DemoResortProfile, localDate: (validTime: string) => string): Promise<{ runs: Map<string, StoredRun[]>; runCount: number; pointCount: number }> {
  const specs: { fetchedAt: string; pastDays: number; horizonDays: number }[] = []
  if (profile.dailyRuns) for (const d of dateRange(TRACKING_START, DEMO_TODAY)) specs.push({ fetchedAt: `${d}${DAILY_RUN_UTC}`, pastDays: 1, horizonDays: 8 })
  specs.push({ fetchedAt: DEMO_NOW, pastDays: 2, horizonDays: 17 })

  const runs = new Map<string, StoredRun[]>()
  let pending: PointInsert[] = []
  let runCount = 0
  let pointCount = 0
  for (const spec of specs) {
    const fc = forecastRun(truth, spec.fetchedAt, spec)
    for (const [key, hourly] of fc.points) {
      if (hourly.length === 0) continue
      const def = truth.points.get(key)!.def
      const [run] = await db
        .insert(s.weatherRuns)
        .values({
          resortId: resort.id,
          pointKey: key,
          provider: DEMO_WEATHER_PROVIDER,
          model: DEMO_MODEL,
          kind: 'demo',
          requestedLat: def.lat,
          requestedLon: def.lon,
          requestedElevationM: def.elevationM,
          gridLat: null,
          gridLon: null,
          gridElevationM: null,
          fetchedAt: spec.fetchedAt,
          modelRunAt: null,
          timezone: resort.timezone,
          horizonDays: spec.horizonDays,
          variables: DEMO_VARIABLES,
          units: DEMO_UNITS,
          intervalSemantics: 'preceding-hour',
          status: 'ok',
          error: null,
          prov: demoProv(
            { fetchedAt: spec.fetchedAt, validFrom: hourly[0].validTime, validTo: hourly[hourly.length - 1].validTime },
            'synthetic weather for the demo, not a real forecast',
          ),
        })
        .returning()
      runCount++
      for (const h of hourly) {
        pending.push({
          runId: run.id,
          validTime: h.validTime,
          localDate: localDate(h.validTime),
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
        })
      }
      pointCount += hourly.length
      runs.set(key, [...(runs.get(key) ?? []), { run, hourly }])
      if (pending.length >= 20_000) {
        await bulkInsert(db, s.weatherPoints, pending)
        pending = []
      }
    }
  }
  await bulkInsert(db, s.weatherPoints, pending)
  return { runs, runCount, pointCount }
}

// ---------------------------------------------------------------------------

export async function demoTableCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of allTables()) out[getTableName(t)] = await rowCount(db, t)
  return out
}

/** Build the whole demo dataset into `db` (which must be the demo database — see prepareDatabase). */
export async function generateDemoData(db: Db, opts: GenerateOptions = {}): Promise<DemoSummary> {
  const log = opts.log ?? (() => {})
  const t0 = performance.now()
  const timingsMs: Record<string, number> = {}
  let mark = t0
  const lap = (name: string) => {
    const t = performance.now()
    timingsMs[name] = Math.round(t - mark)
    mark = t
    log(`demo: ${name} ${timingsMs[name]} ms`)
  }

  const state = await prepareDatabase(db)
  if (state === 'reset') log('demo: wiped an incomplete earlier demo generation')
  await setMeta(db, META_MARKER, DEMO_VERSION, DEMO_NOW)

  // 1. Catalog (the same researched facts as live), preferences, tracking start.
  const catalog = loadCatalog()
  await seedCatalog(db, catalog, DEMO_NOW)
  const prefs = { ...defaultPreferences(DEMO_NOW), onboardingDone: true }
  await db.insert(s.userPreferences).values(prefs).onConflictDoNothing()
  await db.update(s.userPreferences).set({ onboardingDone: true }).where(eq(s.userPreferences.id, 1))
  await setMeta(db, META_TRACKING, TRACKING_START, DEMO_NOW)
  await setMeta(db, META_VERSION, DEMO_VERSION, DEMO_NOW)
  lap('catalog')

  const profiles = DEMO_RESORTS.filter((p) => catalog.resorts.some((r) => r.id === p.id))
  const missingProfiles = DEMO_RESORTS.filter((p) => !profiles.includes(p)).map((p) => p.id)
  if (missingProfiles.length) log(`demo: not in the catalog, skipped: ${missingProfiles.join(', ')}`)
  const resortRows = new Map(
    (
      await db
        .select()
        .from(s.resorts)
        .where(
          inArray(
            s.resorts.id,
            profiles.map((p) => p.id),
          ),
        )
    ).map((r) => [r.id, r]),
  )

  // 2. Weather.
  const localDates = new Map<string, string>()
  const localDateFor = (tz: string) => (validTime: string) => {
    const key = `${tz}|${validTime}`
    let d = localDates.get(key)
    if (d === undefined) {
      d = weatherLocalDate(validTime, 'preceding-hour', tz)
      localDates.set(key, d)
    }
    return d
  }
  const truths = new Map<string, ResortTruth>()
  const runsByResort = new Map<string, Map<string, StoredRun[]>>()
  let runTotal = 0
  let pointTotal = 0
  for (const profile of profiles) {
    const resort = resortRows.get(profile.id)!
    const truth = buildResortTruth(
      {
        id: resort.id,
        timezone: resort.timezone,
        baseElevationM: resort.baseElevationM,
        summitElevationM: resort.summitElevationM,
        weatherPoints: resort.weatherPoints
          .filter((p) => p.key === 'base' || p.key === 'summit')
          .map((p) => ({ key: p.key as 'base' | 'summit', lat: p.lat, lon: p.lon, elevationM: p.elevationM })),
      },
      profile,
    )
    truths.set(profile.id, truth)
    const w = await writeWeather(db, resort, truth, profile, localDateFor(resort.timezone))
    runsByResort.set(profile.id, w.runs)
    runTotal += w.runCount
    pointTotal += w.pointCount
  }
  lap(`weather (${runTotal} runs, ${pointTotal} points)`)

  // 3. Operations: announcements, statements, reports, derived statuses.
  const ops = new Map<string, OperationsResult>()
  for (const profile of profiles) {
    const resort = resortRows.get(profile.id)!
    const totals = terrainTotals(resort.terrain ? { trails: resort.terrain.trails, lifts: resort.terrain.lifts, beginnerPct: resort.terrain.beginnerPct } : null, profile)
    const sims = simulateReports(truths.get(profile.id)!, profile, totals)
    ops.set(profile.id, await simulateOperations(db, resort, profile, sims, totals))
  }
  lap('operations')

  // 4. Personal records (ski-day feedback feeds the assessments).
  const firstRevision = new Map<string, OperationalReportRow>()
  for (const [id, o] of ops) for (const r of o.reports) if (r.revision === 1) firstRevision.set(`${id}|${r.localDate}`, r)
  const altaRuns = runsByResort.get('alta')
  const altaRun = altaRuns?.get('summit')?.find((r) => r.run.fetchedAt === `2027-01-12${DAILY_RUN_UTC}`) ?? altaRuns?.get('base')?.find((r) => r.run.fetchedAt === `2027-01-12${DAILY_RUN_UTC}`)
  const personal = await seedPersonalRecords(db, {
    now: DEMO_NOW,
    units: prefs.units,
    trackingStartInstant: SETUP_AT,
    reportFor: (resortId, date) => firstRevision.get(`${resortId}|${date}`) ?? null,
    altaForecast: altaRun ? { fetchedAt: altaRun.run.fetchedAt, pointKey: altaRun.run.pointKey, hourly: altaRun.hourly } : null,
  })
  lap('personal')

  // 5. Assessments as of the time (morning assessments, previous-morning estimates, today + 16 days).
  const schedules = await db.select().from(s.operatingSchedules).where(eq(s.operatingSchedules.activity, 'lifts'))
  let assessmentTotal = 0
  for (const profile of profiles) {
    const resort = resortRows.get(profile.id)!
    const o = ops.get(profile.id)!
    const tl: ResortTimeline = {
      resort,
      schedules: schedules.filter((x) => x.resortId === resort.id),
      seasonVersions: o.seasonVersions,
      events: o.events,
      reports: o.reports,
      personal: personal.logs
        .filter((l) => l.resortId === resort.id && l.surfaceFeedback.length > 0)
        .map((l) => ({ date: l.date, surfaceTags: l.surfaceFeedback, recordedAt: l.createdAt, note: l.notes })),
      runs: runsByResort.get(profile.id) ?? new Map(),
    }
    const rows = assessResortTimeline(tl, { trackingStart: TRACKING_START, today: DEMO_TODAY, lastDate: LAST_DATE, now: DEMO_NOW, previousMorning: profile.dailyRuns }, prefs.units)
    await bulkInsert(db, s.conditionsAssessments, rows)
    assessmentTotal += rows.length
  }
  lap(`assessments (${assessmentTotal})`)

  await setMeta(db, META_GENERATED, DEMO_NOW, DEMO_NOW)
  const counts = await demoTableCounts(db)
  const totalMs = Math.round(performance.now() - t0)
  return {
    version: DEMO_VERSION,
    now: DEMO_NOW,
    trackingStart: TRACKING_START,
    simulatedResorts: profiles.map((p) => p.id),
    untouchedResorts: catalog.resorts.map((r) => r.id).filter((id) => !profiles.some((p) => p.id === id)),
    counts,
    timingsMs,
    totalMs,
  }
}

const inflight = new WeakMap<Db, Promise<DemoSummary | null>>()

/**
 * Seed the demo database on first use: a no-op (null) once `demo.generatedAt` is set. Concurrent callers share one
 * generation. Refuses (throws) on a database that already holds non-demo data.
 */
export function ensureDemoData(db: Db): Promise<DemoSummary | null> {
  const running = inflight.get(db)
  if (running) return running
  const job = (async () => ((await getMeta(db, META_GENERATED)) ? null : generateDemoData(db)))().finally(() => inflight.delete(db))
  inflight.set(db, job)
  return job
}
