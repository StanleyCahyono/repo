/**
 * Retention simulation: how big does the live database get with daily use?
 *
 * Seeds the real catalog (every resort in catalog/resorts), then runs N simulated once-a-day passes — weather (the REAL
 * Open-Meteo and NWS adapters, fed synthetic API responses of the real size: 19 days × 24 h per Open-Meteo run, ~176 h
 * per NWS run), status, assessments, alerts and prune — with the app clock advancing a day at a time. Weather and
 * assessments run for a subset of resorts (default: 2 US resorts with both providers); the growth is extrapolated
 * linearly to every catalog resort (an overestimate: resorts outside the US get no NWS runs).
 *
 * Size = page_count × page_size after VACUUM (what the single-file build exports), plus row counts and per-table bytes
 * (dbstat). Default settings are small enough for CI; set PISTE_SIM_DAYS / PISTE_SIM_RESORTS (ids or "all") /
 * PISTE_SIM_PASSES (passes per day) / PISTE_SIM_REPORT=1 for a full measurement run.
 */
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { migrationsDir, schema, type Db } from '@/lib/db/client'
import { loadCatalog, seedCatalog } from '@/lib/catalog/seed'
import { favorites, userPreferences } from '@/lib/db/schema'
import { defaultPreferences } from '@/lib/domain/defaults'
import { createHttpClient } from '@/lib/providers/http'
import { createNwsGridWeatherProvider } from '@/lib/providers/weather/nws'
import { createOpenMeteoProvider, OPEN_METEO_HOURLY } from '@/lib/providers/weather/open-meteo'
import { refreshAssessments } from './assessments'
import { pruneAll } from './maintenance'
import { runJob } from './runner'
import { emptyDeps, type JobDeps, type JobName, type JobWork } from './types'
import { refreshWeather } from './weather'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MB = 1024 * 1024

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic API responses (deterministic)

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
/** Uniform in [-1, 1). */
const noise = (s: string) => (hash(s) / 2 ** 32) * 2 - 1
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

/** "True" weather for a place and hour, and a forecast of it made at `fetchMs` (error grows with lead time). */
function weatherAt(place: string, t: number, fetchMs: number, source: string) {
  const day = Math.floor(t / DAY)
  const hourIdx = Math.floor(t / HOUR)
  const lead = Math.max(0, (t - fetchMs) / DAY)
  const e = (k: string) => noise(`${source}|${Math.floor(fetchMs / HOUR)}|${place}|${k}|${hourIdx}`) * (0.3 + 0.25 * lead)
  const stormy = noise(`${place}|storm|${day}`) > 0.35
  const snowTrue = stormy ? Math.max(0, 0.5 + 0.7 * noise(`${place}|s|${hourIdx}`)) : 0
  const snow = Math.max(0, snowTrue * (1 + e('s')) + (lead > 5 && noise(`${fetchMs}|${place}|x|${hourIdx}`) > 0.8 ? 0.1 : 0))
  const temp = -6 + 5 * Math.sin((2 * Math.PI * ((t / HOUR) % 24 - 20)) / 24) + 4 * noise(`${place}|td|${day}`) + 3 * e('t')
  const wind = Math.max(0, 14 + 10 * noise(`${place}|w|${day}`) + 6 * e('w'))
  const cloud = Math.min(100, Math.max(0, Math.round(stormy ? 95 + 5 * e('c') : 45 + 50 * noise(`${place}|c|${hourIdx}`))))
  return {
    temp,
    apparent: temp - 3 - wind / 8,
    snow,
    precip: snow * 0.7,
    rain: temp > 1 ? Math.max(0, 0.3 * e('r')) : 0,
    depth: 0.6 + 0.4 * Math.abs(noise(`${place}|d|${Math.floor(day / 7)}`)),
    wind,
    gust: wind * 1.8 + 4 * Math.abs(e('g')),
    humidity: Math.min(100, Math.max(40, Math.round(80 + 15 * noise(`${place}|h|${hourIdx}`)))),
    cloud,
    visibility: snow > 0.3 ? Math.round(900 + 4000 * Math.abs(e('v'))) : 24140,
    freezing: Math.max(0, Math.round((temp + 6) * 150)),
    code: snow > 0.8 ? 75 : snow > 0.3 ? 73 : snow > 0 ? 71 : cloud > 85 ? 3 : cloud > 50 ? 2 : cloud > 15 ? 1 : 0,
  }
}

function openMeteoBody(url: URL, fetchMs: number) {
  const q = url.searchParams
  const lat = Number(q.get('latitude'))
  const lon = Number(q.get('longitude'))
  const place = `${lat},${lon}`
  const past = Number(q.get('past_days'))
  const days = Number(q.get('forecast_days'))
  const start = Math.floor(fetchMs / DAY) * DAY - past * DAY
  const n = (past + days) * 24
  const time: number[] = []
  const cols: Record<string, (number | null)[]> = Object.fromEntries(OPEN_METEO_HOURLY.map((v) => [v, []]))
  for (let i = 0; i < n; i++) {
    const t = start + i * HOUR
    const w = weatherAt(place, t, fetchMs, 'om')
    time.push(t / 1000)
    const local = ((t / HOUR) % 24) + (lon / 15)
    const vals: Record<string, number> = {
      temperature_2m: r1(w.temp),
      apparent_temperature: r1(w.apparent),
      precipitation: r1(w.precip),
      rain: r1(w.rain),
      snowfall: r2(w.snow),
      snow_depth: r2(w.depth),
      weather_code: w.code,
      cloud_cover: w.cloud,
      visibility: w.visibility,
      wind_speed_10m: r1(w.wind),
      wind_gusts_10m: r1(w.gust),
      relative_humidity_2m: w.humidity,
      freezing_level_height: w.freezing,
      is_day: ((local % 24) + 24) % 24 >= 7 && ((local % 24) + 24) % 24 < 17 ? 1 : 0,
    }
    for (const v of OPEN_METEO_HOURLY) cols[v].push(vals[v] ?? null)
  }
  return {
    latitude: Math.round(lat * 40) / 40,
    longitude: Math.round(lon * 40) / 40,
    generationtime_ms: 2.1,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: Number(q.get('elevation') ?? 1000),
    hourly_units: {
      time: 'unixtime',
      temperature_2m: '°C',
      apparent_temperature: '°C',
      precipitation: 'mm',
      rain: 'mm',
      snowfall: 'cm',
      snow_depth: 'm',
      weather_code: 'wmo code',
      cloud_cover: '%',
      visibility: 'm',
      wind_speed_10m: 'km/h',
      wind_gusts_10m: 'km/h',
      relative_humidity_2m: '%',
      freezing_level_height: 'm',
      is_day: '',
    },
    hourly: { time, ...cols },
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', '+00:00')

function nwsGridBody(place: string, fetchMs: number) {
  // NWS grids start at the current forecast period (a few hours back) and run ~7 days 19 hours.
  const start = Math.floor(fetchMs / HOUR) * HOUR - 8 * HOUR
  const hours = 7 * 24 + 19
  const layer = (uom: string, step: number, fn: (w: ReturnType<typeof weatherAt>) => number | null, sum = false) => {
    const values = []
    for (let h = 0; h < hours; h += step) {
      const t = start + h * HOUR
      let v: number | null = 0
      for (let k = 0; k < (sum ? step : 1); k++) {
        const x = fn(weatherAt(place, t + k * HOUR, fetchMs, 'nws'))
        v = x === null || v === null ? null : v + x
      }
      values.push({ validTime: `${iso(t)}/PT${step}H`, value: v })
    }
    return { uom, values }
  }
  const f = (c: number) => ((Math.round(c * 1.8 + 32) - 32) * 5) / 9
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[-76.1571, 42.5165], [-76.1535, 42.4944], [-76.1236, 42.4971], [-76.1272, 42.5192], [-76.1571, 42.5165]]] },
    properties: {
      updateTime: iso(fetchMs - 3 * HOUR),
      validTimes: `${iso(start)}/P7DT19H`,
      elevation: { unitCode: 'wmoUnit:m', value: 1234.44 },
      gridId: 'SLC',
      temperature: layer('wmoUnit:degC', 1, (w) => f(w.temp)),
      apparentTemperature: layer('wmoUnit:degC', 1, (w) => f(w.apparent)),
      relativeHumidity: layer('wmoUnit:percent', 1, (w) => w.humidity),
      windSpeed: layer('wmoUnit:km_h-1', 2, (w) => Math.round(w.wind / 1.852) * 1.852),
      windGust: layer('wmoUnit:km_h-1', 2, (w) => Math.round(w.gust / 1.852) * 1.852),
      skyCover: layer('wmoUnit:percent', 1, (w) => w.cloud),
      visibility: layer('wmoUnit:m', 3, (w) => Math.round(w.visibility / 1609.344) * 1609.344),
      snowfallAmount: layer('wmoUnit:mm', 6, (w) => Math.round(w.snow * 10 * 3.937) / 3.937, true),
      quantitativePrecipitation: layer('wmoUnit:mm', 6, (w) => Math.round(w.precip * 3.937) / 3.937, true),
    },
  }
}

/** An HTTP client answering like api.open-meteo.com and api.weather.gov at the simulated instant. */
function simHttp(clock: () => string) {
  const grids = new Map<string, string>()
  return createHttpClient({
    fetch: async (u) => {
      const url = new URL(String(u))
      const fetchMs = Date.parse(clock())
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.host === 'api.open-meteo.com') return json(openMeteoBody(url, fetchMs))
      const m = url.pathname.match(/^\/points\/(.+)$/)
      if (m) {
        const gridUrl = `https://api.weather.gov/gridpoints/SLC/${hash(m[1]) % 200},${hash(`y${m[1]}`) % 200}`
        grids.set(gridUrl, m[1])
        const [x, y] = gridUrl.split('/').pop()!.split(',').map(Number)
        return json({ properties: { gridId: 'SLC', gridX: x, gridY: y, forecastGridData: gridUrl, timeZone: 'America/Denver' } })
      }
      const place = grids.get(url.toString())
      if (place) return json(nwsGridBody(place, fetchMs))
      return new Response('not found', { status: 404 })
    },
    sleep: async () => {},
    random: () => 0.5,
    nowMs: () => Date.parse(clock()),
    nowIso: clock,
    env: () => ({}),
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Simulation

export interface SimOptions {
  days: number
  /** Resort ids that get weather and assessments. */
  resorts: readonly string[]
  /** Refresh passes per day (1 = the single file opened once a day). */
  passesPerDay: number
  /** Days measured (1-based day numbers, after that day's passes). */
  checkpoints: readonly number[]
  env?: Record<string, string>
  /** SQLite page size for the measured file (the single-file build uses 16384). */
  pageSize?: number
  /** Favourites besides the catalog's first-run defaults (Greek Peak, Alta). */
  favorites?: readonly string[]
  /** Days assessed ahead (default: the forecast's horizon, as the app does; fewer only to keep CI fast). */
  assessDays?: number
  /** Seed only the simulated resorts instead of the whole catalog (faster; the base size is then not the app's). */
  smallCatalog?: boolean
}

export interface Measurement {
  day: number
  bytes: number
  rows: Record<string, number>
  tables: Record<string, number>
  /** Rows per resort: weather runs, weather hours, assessments. */
  perResort: Record<string, { runs: number; points: number; assessments: number }>
}

const COUNTED = ['weather_runs', 'weather_points', 'conditions_assessments', 'source_records', 'refresh_runs', 'status_events', 'alerts'] as const

export async function measure(db: Db, day: number): Promise<Measurement> {
  await db.run(sql`VACUUM`)
  const [pc] = await db.all<{ page_count: number }>(sql`PRAGMA page_count`)
  const [ps] = await db.all<{ page_size: number }>(sql`PRAGMA page_size`)
  const rows: Record<string, number> = {}
  for (const t of COUNTED) rows[t] = Number((await db.all<{ n: number }>(sql.raw(`select count(*) as n from ${t}`)))[0].n)
  const tables: Record<string, number> = {}
  for (const r of await db.all<{ name: string; tbl: string; bytes: number }>(
    sql`select s.name as name, coalesce(m.tbl_name, s.name) as tbl, sum(s.pgsize) as bytes from dbstat s left join sqlite_schema m on m.name = s.name group by s.name`,
  )) {
    tables[r.tbl] = (tables[r.tbl] ?? 0) + Number(r.bytes)
  }
  const perResort: Measurement['perResort'] = {}
  const at = (id: string) => (perResort[id] ??= { runs: 0, points: 0, assessments: 0 })
  for (const r of await db.all<{ id: string; runs: number; points: number }>(
    sql`select r.resort_id as id, count(distinct r.id) as runs, count(p.run_id) as points from weather_runs r left join weather_points p on p.run_id = r.id group by r.resort_id`,
  )) {
    at(r.id).runs = Number(r.runs)
    at(r.id).points = Number(r.points)
  }
  for (const r of await db.all<{ id: string; n: number }>(sql`select resort_id as id, count(*) as n from conditions_assessments group by resort_id`)) at(r.id).assessments = Number(r.n)
  return { day, bytes: Number(pc.page_count) * Number(ps.page_size), rows, tables, perResort }
}

export async function simulate(o: SimOptions): Promise<{ base: Measurement; points: Measurement[]; db: Db }> {
  const saved = { ...process.env }
  Object.assign(process.env, o.env ?? {})
  try {
    // An in-memory database cannot change its page size later, so it is set before the schema exists.
    const client = createClient({ url: ':memory:' })
    if (o.pageSize) await client.execute(`PRAGMA page_size = ${o.pageSize}`)
    const db = drizzle(client, { schema })
    await client.execute('PRAGMA foreign_keys = ON')
    await migrate(db, { migrationsFolder: migrationsDir() })
    const start = Date.parse('2026-12-01T13:00:00.000Z') // 08:00 in New York
    let nowMs = start
    const clock = () => new Date(nowMs).toISOString()
    const catalog = loadCatalog()
    await seedCatalog(db, o.smallCatalog ? { ...catalog, resorts: catalog.resorts.filter((r) => o.resorts.includes(r.id)), events: null, hotels: null } : catalog, clock())
    await db.insert(userPreferences).values(defaultPreferences(clock())).onConflictDoNothing()
    for (const [i, id] of (o.favorites ?? []).entries()) await db.insert(favorites).values({ resortId: id, addedAt: clock(), sortOrder: 10 + i }).onConflictDoNothing()
    const base = await measure(db, 0)

    const work: Partial<Record<JobName, JobWork>> = {
      weather: (ctx) => refreshWeather(ctx, { resortIds: o.resorts }),
      assessments: (ctx) => refreshAssessments(ctx, { resortIds: o.resorts, horizonDays: o.assessDays }),
      prune: (ctx) => pruneAll(ctx),
    }
    const points: Measurement[] = []
    for (let day = 1; day <= o.days; day++) {
      for (let p = 0; p < o.passesPerDay; p++) {
        // The file is opened at a slightly different time every day.
        nowMs = start + (day - 1) * DAY + p * Math.floor(DAY / o.passesPerDay) + ((day * 37) % 90) * 60_000
        const http = simHttp(clock)
        const deps: JobDeps = emptyDeps({
          weatherProviders: [createOpenMeteoProvider({ http, cacheTtlMs: 0 }), createNwsGridWeatherProvider({ http })],
          sleep: async () => {},
        })
        for (const job of ['weather', 'status', 'assessments', 'alerts', 'prune'] as const) {
          const s = await runJob({ db, job, trigger: 'schedule', now: clock(), deps, work: work[job], maxAttempts: 1 })
          if (s.status === 'error') throw new Error(`${job} failed on day ${day}: ${s.error}`)
        }
      }
      if (o.checkpoints.includes(day)) points.push(await measure(db, day))
    }
    return { base, points, db }
  } finally {
    for (const k of Object.keys(o.env ?? {})) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

/** Resorts in the catalog (derived, so the projection follows the catalog as resorts are added). */
const catalogResorts = () => loadCatalog().resorts.length
const HISTORY_TABLES = ['weather_points', 'weather_runs', 'conditions_assessments'] as const
const historyBytes = (m: Measurement) => HISTORY_TABLES.reduce((a, t) => a + (m.tables[t] ?? 0), 0)

/**
 * Size for every catalog resort: everything the simulation added on top of the catalog, scaled linearly from the
 * simulated resorts (bookkeeping tables are scaled too — an overestimate), plus the history tables' growth rate between
 * the last two checkpoints for the remaining days.
 */
export function project(base: Measurement, points: readonly Measurement[], simulatedResorts: number, horizonDays = 200, totalResorts = catalogResorts()) {
  const scale = totalResorts / simulatedResorts
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  const perDay = ((historyBytes(b) - historyBytes(a)) / (b.day - a.day)) * scale
  const atLast = base.bytes + (b.bytes - base.bytes) * scale
  return { scale, totalResorts, perDayMB: perDay / MB, lastMB: atLast / MB, lastDay: b.day, projectedMB: (atLast + perDay * Math.max(0, horizonDays - b.day)) / MB }
}

function report(label: string, base: Measurement, points: readonly Measurement[], simulated: number) {
  const p = project(base, points, simulated)
  const lines = [
    `${label}: ${simulated} resort(s) simulated, extrapolated ×${p.scale.toFixed(1)} to ${p.totalResorts}`,
    `  base (catalog only) ${(base.bytes / MB).toFixed(2)} MB`,
    ...points.map(
      (m) =>
        `  day ${String(m.day).padStart(3)}: ${(m.bytes / MB).toFixed(2)} MB simulated · rows ${Object.entries(m.rows)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')} · MB ${['weather_points', 'weather_runs', 'conditions_assessments', 'refresh_runs', 'source_records']
          .map((k) => `${k}=${((m.tables[k] ?? 0) / MB).toFixed(2)}`)
          .join(' ')}`,
    ),
    `  history growth ${p.perDayMB.toFixed(3)} MB/day (${p.totalResorts} resorts) · day ${p.lastDay}: ${p.lastMB.toFixed(1)} MB · 200-day projection ${p.projectedMB.toFixed(1)} MB`,
  ]
  console.log(lines.join('\n'))
  return p
}

const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined)

/** The single-file build's settings (standalone/build.mjs). */
export const SINGLE_FILE_ENV = {
  PISTE_WEATHER_RETENTION_DAYS: '0.25',
  PISTE_WEATHER_HISTORY_DAYS: '14',
  PISTE_ASSESSMENT_DETAIL_DAYS: '14',
  PISTE_PRUNE_VACUUM: '1',
  PISTE_DB_PAGE_SIZE: '16384',
}

describe('retention simulation (once-a-day use)', () => {
  it('keeps the single-file database bounded', { timeout: 120_000 }, async () => {
    // The single-file settings with 2-day limits (instead of 14) so ten daily passes reach the steady state, and
    // assessments 3 days ahead (instead of 16) to keep CI fast: Greek Peak is a favourite, Snowbird is not.
    const env = { ...SINGLE_FILE_ENV, PISTE_WEATHER_HISTORY_DAYS: '2', PISTE_ASSESSMENT_DETAIL_DAYS: '2' }
    const { base, points } = await simulate({ days: 10, resorts: ['greek-peak', 'snowbird'], passesPerDay: 1, checkpoints: [6, 10], env, pageSize: 16384, assessDays: 3, smallCatalog: true })
    const [a, b] = points
    const fav = (m: Measurement) => m.perResort['greek-peak']
    const other = (m: Measurement) => m.perResort.snowbird
    // A favourite keeps one trimmed run per point and past day (26 hours each) besides the whole latest pass.
    expect(fav(b).runs - fav(a).runs).toBe(4 * 2)
    expect(fav(b).points - fav(a).points).toBe(4 * 2 * 26)
    // Another resort keeps forecast-then for the last 2 days only: its weather stops growing.
    expect(other(b)).toMatchObject({ runs: other(a).runs, points: other(a).points })
    expect(other(b).points).toBeLessThan(2 * 456 + 2 * 180 + 3 * 2 * 26)
    // Assessments: past days beyond the limit keep one row per mode ("estimated then").
    for (const r of [fav, other]) expect(r(b).assessments - r(a).assessments).toBe(4 * 3)
    // History grows by well under 20 KB per resort and day (the old prune kept ~400 KB).
    expect((historyBytes(b) - historyBytes(a)) / 4 / 2).toBeLessThan(20 * 1024)
    expect(b.bytes - base.bytes).toBeLessThan(4 * MB)
  })

  // PISTE_SIM_REPORT=1 [PISTE_SIM_DAYS=70] [PISTE_SIM_RESORTS=a,b] [PISTE_SIM_FAVORITES=a] [PISTE_SIM_PASSES=1]
  // [PISTE_SIM_SINGLE_FILE=1 | PISTE_WEATHER_RETENTION_DAYS=…] [PISTE_SIM_PAGE_SIZE=16384]
  it.runIf(!!process.env.PISTE_SIM_REPORT)('reports database growth', { timeout: 3_600_000 }, async () => {
    const days = Number(process.env.PISTE_SIM_DAYS) || 20
    const resorts = list(process.env.PISTE_SIM_RESORTS) ?? ['greek-peak', 'alta']
    const passesPerDay = Number(process.env.PISTE_SIM_PASSES) || 1
    const pageSize = Number(process.env.PISTE_SIM_PAGE_SIZE) || undefined
    const checkpoints = [...new Set([Math.max(1, days - 10), Math.max(2, days - 5), days])]
    const env: Record<string, string> = process.env.PISTE_SIM_SINGLE_FILE ? SINGLE_FILE_ENV : {}
    const { base, points } = await simulate({ days, resorts, passesPerDay, checkpoints, pageSize, env, favorites: list(process.env.PISTE_SIM_FAVORITES) })
    const retention = env.PISTE_WEATHER_RETENTION_DAYS ?? process.env.PISTE_WEATHER_RETENTION_DAYS ?? '14'
    report(`${process.env.PISTE_SIM_SINGLE_FILE ? 'single-file settings' : `retention ${retention} d`}, ${passesPerDay} pass/day, page ${pageSize ?? 4096}`, base, points, resorts.length)
  })
})
