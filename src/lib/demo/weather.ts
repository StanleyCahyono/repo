/**
 * Synthetic, physically plausible hourly weather for the demo (pure — no database).
 *
 * - "Truth" is what the simulated weather actually did, per resort and weather point (base / summit): regional
 *   drivers (smooth temperature anomaly, storms every 3–6 days, wind, cloud, humidity) plus scripted events, then per
 *   point a climatology, a diurnal cycle, a 6.5 °C/km lapse rate, orographic enhancement, snow/rain partition by
 *   temperature, visibility, freezing level and a modeled snow depth.
 * - A forecast run fetched at F repeats the truth for hours before F and adds errors that grow with lead time
 *   (temperature bias, storm timing shift, precipitation and wind factors, trend smoothing beyond day 7), so "what
 *   was forecast then" differs from what was later reported.
 * - Values are stored with Open-Meteo's 'preceding-hour' semantics: an accumulation stamped T covers (T−1 h, T].
 * Everything is deterministic (named PRNG streams) and dated on or after the tracking start.
 */
import { DateTime } from 'luxon'
import type { HourlyWeather } from '@/lib/providers/types'
import { endOfLocalDay, startOfLocalDay } from '@/lib/domain/time'
import { rng } from './prng'
import {
  ANOMALY_SCRIPTS,
  LAST_DATE,
  PROTECTED_WINDOWS,
  REGION_TZ,
  SCRIPTED_STORMS,
  TRACKING_START,
  WIND_EVENT,
  type DemoResortProfile,
  type Region,
} from './scenario'

export const HOUR_MS = 3_600_000
export const LAPSE_C_PER_M = 0.0065

/** Global hourly grid (UTC) the regional drivers are computed on. Covers every resort's local tracking window. */
const GRID_START_MS = Date.parse('2026-11-30T00:00:00.000Z')
const GRID_END_MS = Date.parse('2027-02-02T12:00:00.000Z')
const GRID_N = (GRID_END_MS - GRID_START_MS) / HOUR_MS + 1
const gridIndex = (ms: number) => Math.round((ms - GRID_START_MS) / HOUR_MS)

const isoOf = (ms: number) => new Date(ms).toISOString()
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** UTC ms of a region-local wall time 'YYYY-MM-DDTHH:mm'. */
export function regionMs(region: Region, local: string): number {
  const dt = DateTime.fromISO(local, { zone: REGION_TZ[region] })
  if (!dt.isValid) throw new Error(`Invalid local time ${local}`)
  return dt.toMillis()
}

const hourCache = new Map<string, number>()
/** Resort-local hour of an instant (memoised; Luxon handles the zone). */
export function localHour(ms: number, tz: string): number {
  const key = `${tz}|${ms}`
  let h = hourCache.get(key)
  if (h === undefined) {
    const dt = DateTime.fromMillis(ms, { zone: tz })
    h = dt.hour + dt.minute / 60
    hourCache.set(key, h)
  }
  return h
}

// ---------------------------------------------------------------------------
// Climate

interface RegionClimate {
  /** Mean temperature (°C) at `refElevM` on 1 Dec and on 31 Jan (linear in between). */
  climo: [number, number]
  refElevM: number
  diurnalAmpC: number
  anomalyAmp: [number, number, number]
  windBase: number
  windAmp: number
  summitWindMult: number
  stormWater: [number, number]
}

const CLIMATE: Record<Region, RegionClimate> = {
  east: { climo: [-2.5, -7], refElevM: 500, diurnalAmpC: 3, anomalyAmp: [1.8, 2.4, 2.8], windBase: 11, windAmp: 4, summitWindMult: 1.8, stormWater: [4, 13] },
  utah: { climo: [-5, -8], refElevM: 2600, diurnalAmpC: 4.5, anomalyAmp: [1.4, 1.8, 2.2], windBase: 7, windAmp: 3, summitWindMult: 2, stormWater: [7, 18] },
  colorado: { climo: [-7, -10], refElevM: 2900, diurnalAmpC: 4.5, anomalyAmp: [1.4, 1.8, 2.2], windBase: 9, windAmp: 4, summitWindMult: 2, stormWater: [4, 12] },
}

const CLIMO_FROM_MS = Date.parse(`${TRACKING_START}T12:00:00.000Z`)
const CLIMO_TO_MS = Date.parse(`${LAST_DATE}T12:00:00.000Z`)

/** Seasonal mean temperature at the region's reference elevation. */
export function climoC(region: Region, ms: number): number {
  const [a, b] = CLIMATE[region].climo
  const f = clamp((ms - CLIMO_FROM_MS) / (CLIMO_TO_MS - CLIMO_FROM_MS), 0, 1)
  return a + (b - a) * f
}

/** Diurnal shape: −1 at 07:00, +1 at 15:00 local. */
function diurnalShape(h: number): number {
  if (h >= 7 && h <= 15) return -Math.cos((Math.PI * (h - 7)) / 8)
  return Math.cos((Math.PI * ((h - 15 + 24) % 24)) / 16)
}

/** Wind chill (Environment Canada / NWS) for T ≤ 10 °C and wind > 4.8 km/h. */
export function windChill(t: number, v: number): number {
  if (t > 10 || v <= 4.8) return t
  const p = v ** 0.16
  return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p
}

// ---------------------------------------------------------------------------
// Regional drivers

export interface Storm {
  id: string
  startMs: number
  endMs: number
  waterMm: number
  windBoostKmh: number
  scripted: boolean
  bust?: { fetchedAt: string; factor: number }[]
}

export interface RegionDrivers {
  region: Region
  anomaly: Float64Array
  /** Liquid water (mm) falling in the hour ending at each grid stamp, regional (before resort multipliers). */
  water: Float64Array
  lake: Float64Array
  wind: Float64Array
  cloud: Float64Array
  humidity: Float64Array
  storms: Storm[]
}

/** Water of a sine-shaped storm falling in (a, b] (ms). Integrates exactly to the storm total. */
function stormWater(s: Storm, a: number, b: number): number {
  const lo = Math.max(a, s.startMs)
  const hi = Math.min(b, s.endMs)
  if (hi <= lo) return 0
  const dur = s.endMs - s.startMs
  return (s.waterMm / 2) * (Math.cos((Math.PI * (lo - s.startMs)) / dur) - Math.cos((Math.PI * (hi - s.startMs)) / dur))
}

function overlapsProtected(region: Region, from: number, to: number, marginH = 12): boolean {
  return PROTECTED_WINDOWS[region].some(([a, b]) => from < regionMs(region, b) + marginH * HOUR_MS && to > regionMs(region, a) - marginH * HOUR_MS)
}

function scriptedAnomaly(region: Region): ((ms: number) => { value: number; weight: number }) | null {
  const keys = ANOMALY_SCRIPTS[region].map(([t, v]) => [regionMs(region, t), v] as const)
  if (keys.length < 3) return null
  const first = keys[0][0]
  const second = keys[1][0]
  const penult = keys[keys.length - 2][0]
  const last = keys[keys.length - 1][0]
  return (ms) => {
    if (ms <= first || ms >= last) return { value: 0, weight: 0 }
    let i = 0
    while (i < keys.length - 2 && keys[i + 1][0] <= ms) i++
    const [t0, v0] = keys[i]
    const [t1, v1] = keys[i + 1]
    const value = v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0)
    const weight = ms < second ? (ms - first) / (second - first) : ms > penult ? (last - ms) / (last - penult) : 1
    return { value, weight }
  }
}

const driverCache = new Map<Region, RegionDrivers>()

/** Regional drivers on the global grid (deterministic, memoised). */
export function regionDrivers(region: Region): RegionDrivers {
  const hit = driverCache.get(region)
  if (hit) return hit
  const c = CLIMATE[region]
  const r = rng(`drivers|${region}`)

  // Storms: scripted + random every 3–6 days outside the protected windows.
  const storms: Storm[] = SCRIPTED_STORMS.filter((s) => s.region === region).map((s) => {
    const startMs = regionMs(region, s.start)
    return { id: s.id, startMs, endMs: startMs + s.hours * HOUR_MS, waterMm: s.waterMm, windBoostKmh: s.windBoostKmh, scripted: true, bust: s.bust }
  })
  const rs = rng(`storms|${region}`)
  let t = GRID_START_MS + Math.round(rs.uniform(20, 60)) * HOUR_MS
  let n = 0
  while (t < GRID_END_MS) {
    const hours = Math.round(rs.uniform(10, 30))
    const water = rs.uniform(c.stormWater[0], c.stormWater[1])
    const boost = rs.uniform(8, 20)
    const end = t + hours * HOUR_MS
    if (!overlapsProtected(region, t, end)) storms.push({ id: `${region}-random-${++n}`, startMs: t, endMs: end, waterMm: water, windBoostKmh: boost, scripted: false })
    t += Math.round(rs.uniform(72, 144)) * HOUR_MS
  }
  storms.sort((a, b) => a.startMs - b.startMs)

  const periods = [r.uniform(60, 90), r.uniform(110, 160), r.uniform(200, 280)]
  const phases = periods.map(() => r.uniform(0, 2 * Math.PI))
  const amps = c.anomalyAmp.map((a) => a * r.uniform(0.8, 1.2))
  const cloudP = r.uniform(40, 70)
  const cloudPh = r.uniform(0, 2 * Math.PI)
  const windP = r.uniform(30, 60)
  const windPh = r.uniform(0, 2 * Math.PI)
  const rhP = r.uniform(50, 90)
  const rhPh = r.uniform(0, 2 * Math.PI)
  const script = scriptedAnomaly(region)

  const d: RegionDrivers = {
    region,
    anomaly: new Float64Array(GRID_N),
    water: new Float64Array(GRID_N),
    lake: new Float64Array(GRID_N),
    wind: new Float64Array(GRID_N),
    cloud: new Float64Array(GRID_N),
    humidity: new Float64Array(GRID_N),
    storms,
  }
  for (let k = 0; k < GRID_N; k++) {
    const ms = GRID_START_MS + k * HOUR_MS
    const th = k // hours since grid start
    let random = amps.reduce((acc, a, i) => acc + a * Math.sin((2 * Math.PI * th) / periods[i] + phases[i]), 0)
    let water = 0
    let windBoost = 0
    let stormCloud = 0
    let stormRh = 0
    for (const s of storms) {
      water += stormWater(s, ms - HOUR_MS, ms)
      if (ms > s.startMs - 6 * HOUR_MS && ms < s.endMs + 4 * HOUR_MS) {
        const ramp = ms < s.startMs ? 1 - (s.startMs - ms) / (6 * HOUR_MS) : ms > s.endMs ? 1 - (ms - s.endMs) / (4 * HOUR_MS) : 1
        stormCloud = Math.max(stormCloud, 97 * ramp)
        stormRh = Math.max(stormRh, 95 * ramp)
      }
      if (ms >= s.startMs && ms <= s.endMs + 3 * HOUR_MS) {
        const f = Math.sin((Math.PI * Math.min(1, (ms - s.startMs) / (s.endMs + 3 * HOUR_MS - s.startMs))) as number)
        windBoost = Math.max(windBoost, s.windBoostKmh * f)
      }
      // Clouds keep a storm mild; cold air follows it.
      if (ms >= s.startMs && ms <= s.endMs) random += 1
      else if (ms > s.endMs && ms <= s.endMs + 18 * HOUR_MS) random -= 2 * (1 - (ms - s.endMs) / (18 * HOUR_MS))
      // Lake-effect showers behind random East storms when cold enough (never inside the scripted story).
      if (region === 'east' && !s.scripted && ms > s.endMs && ms <= s.endMs + 18 * HOUR_MS) d.lake[k] = Math.max(d.lake[k], 0.12)
    }
    const sc = script ? script(ms) : { value: 0, weight: 0 }
    d.anomaly[k] = (1 - sc.weight) * random + sc.weight * sc.value
    if (d.lake[k] > 0 && d.anomaly[k] > -1.5) d.lake[k] = 0
    d.water[k] = water
    d.wind[k] = Math.max(2, c.windBase + c.windAmp * Math.sin((2 * Math.PI * th) / windP + windPh) + windBoost)
    d.cloud[k] = Math.max(clamp(45 + 25 * Math.sin((2 * Math.PI * th) / cloudP + cloudPh), 5, 90), stormCloud)
    d.humidity[k] = Math.max(clamp(70 + 12 * Math.sin((2 * Math.PI * th) / rhP + rhPh), 45, 90), stormRh)
  }
  // Fog and saturated air with the East thaw.
  if (region === 'east') {
    const a = gridIndex(regionMs('east', '2027-01-11T02:00'))
    const b = gridIndex(regionMs('east', '2027-01-11T12:00'))
    for (let k = a; k <= b; k++) d.humidity[k] = 99
  }
  driverCache.set(region, d)
  return d
}

// ---------------------------------------------------------------------------
// Point physics

/** What drives one hour at one point before derived quantities. */
export interface RawHour {
  tempC: number
  /** Liquid water equivalent (mm) in the hour ending at the stamp. */
  waterMm: number
  windKmh: number
  gustRatio: number
  cloudPct: number
  humidityPct: number
}

export interface PointContext {
  elevationM: number
  summit: boolean
  tz: string
}

/** Snow fraction of precipitation: all snow at ≤ 0.5 °C, all rain at ≥ 2.5 °C. */
export function snowFraction(tempC: number): number {
  return tempC <= 0.5 ? 1 : tempC >= 2.5 ? 0 : (2.5 - tempC) / 2
}

/** Snow-to-liquid ratio: colder snow is lighter (8:1 near freezing … 17:1 in deep cold). */
export function snowLiquidRatio(tempC: number): number {
  return clamp(10 - 0.6 * tempC, 8, 17)
}

function weatherCode(snowCm: number, rainMm: number, tempC: number, cloud: number, fog: boolean): number {
  if (snowCm >= 2.5) return 75
  if (snowCm >= 0.8) return 73
  if (snowCm >= 0.05) return 71
  if (rainMm >= 0.1 && tempC <= 0) return 66
  if (rainMm >= 4) return 65
  if (rainMm >= 1) return 63
  if (rainMm >= 0.1) return 61
  if (fog) return 45
  if (cloud >= 85) return 3
  if (cloud >= 45) return 2
  if (cloud >= 15) return 1
  return 0
}

/** Derived hourly values (everything except snow depth) from the raw drivers. */
export function deriveHour(ms: number, raw: RawHour, p: PointContext): Omit<HourlyWeather, 'snowDepthM'> {
  const t = raw.tempC
  const water = Math.max(0, raw.waterMm)
  const f = snowFraction(t)
  const snowCm = (water * f * snowLiquidRatio(t)) / 10
  const rainMm = water * (1 - f)
  const wind = Math.max(0, raw.windKmh)
  const fog = raw.humidityPct >= 97 && water < 0.05
  let vis: number
  if (snowCm >= 0.05) vis = clamp(9000 * Math.exp(-1.1 * snowCm), 250, 9000)
  else if (rainMm >= 0.1) vis = clamp(8000 - 900 * rainMm, 1500, 8000)
  else if (fog) vis = 900
  else vis = 24000 - 60 * raw.cloudPct
  if (p.summit && water > 0.05) vis *= 0.6
  const h = localHour(ms, p.tz)
  return {
    validTime: isoOf(ms),
    temperatureC: round(t, 1),
    apparentTemperatureC: round(windChill(t, wind), 1),
    snowfallCm: round(snowCm, 2),
    rainMm: round(rainMm, 1),
    precipitationMm: round(water, 1),
    windKmh: round(wind, 1),
    gustKmh: round(wind * raw.gustRatio, 1),
    humidityPct: Math.round(clamp(raw.humidityPct, 0, 100)),
    visibilityM: Math.round(vis / 10) * 10,
    cloudCoverPct: Math.round(clamp(raw.cloudPct, 0, 100)),
    freezingLevelM: Math.max(0, Math.round(p.elevationM + t / LAPSE_C_PER_M)),
    weatherCode: weatherCode(snowCm, rainMm, t, raw.cloudPct, fog),
    isDay: h >= 8 && h <= 16,
  }
}

/** One hour of the modeled snow-depth state (m): accumulation, melt, rain, settling. */
export function stepSnowDepth(depthM: number, h: Pick<HourlyWeather, 'snowfallCm' | 'temperatureC' | 'rainMm'>): number {
  let d = depthM + ((h.snowfallCm ?? 0) / 100) * 0.85
  const t = h.temperatureC ?? 0
  if (t > 0) d -= 0.0009 * t + 0.0005 * (h.rainMm ?? 0)
  d -= d * 0.0005
  return Math.max(0, d)
}

const INITIAL_DEPTH_M: Record<Region, { base: number; summit: number }> = {
  east: { base: 0.05, summit: 0.15 },
  utah: { base: 0.5, summit: 0.8 },
  colorado: { base: 0.4, summit: 0.6 },
}

// ---------------------------------------------------------------------------
// Truth per resort

export interface DemoWeatherPointDef {
  key: 'base' | 'summit'
  lat: number
  lon: number
  /** Catalog elevation (null = unknown; stored as-is). */
  elevationM: number | null
}

export interface ResortLike {
  id: string
  timezone: string
  baseElevationM: number | null
  summitElevationM: number | null
  weatherPoints: DemoWeatherPointDef[]
}

export interface PointTruth {
  def: DemoWeatherPointDef
  /** Elevation the simulation used (catalog value, else resort elevation, else a simulation-only assumption). */
  simElevationM: number
  raw: RawHour[]
  hourly: HourlyWeather[]
}

export interface ResortTruth {
  resortId: string
  tz: string
  region: Region
  profile: DemoResortProfile
  firstMs: number
  stampMs: number[]
  points: Map<string, PointTruth>
  /** Regional temperature anomaly at each stamp (for forecast trend damping). */
  anomaly: number[]
}

/** First and last stamps (inclusive) covering resort-local days [from, to] with preceding-hour semantics. */
export function stampRange(from: string, to: string, tz: string): [number, number] {
  return [Date.parse(startOfLocalDay(from, tz)) + HOUR_MS, Date.parse(endOfLocalDay(to, tz))]
}

export function buildResortTruth(resort: ResortLike, profile: DemoResortProfile): ResortTruth {
  const tz = resort.timezone
  const region = profile.region
  const drivers = regionDrivers(region)
  const c = CLIMATE[region]
  const [firstMs, lastMs] = stampRange(TRACKING_START, LAST_DATE, tz)
  const stampMs: number[] = []
  for (let ms = firstMs; ms <= lastMs; ms += HOUR_MS) stampMs.push(ms)
  const anomaly = stampMs.map((ms) => drivers.anomaly[gridIndex(ms)])
  const baseElev = resort.weatherPoints.find((p) => p.key === 'base')?.elevationM ?? resort.baseElevationM ?? profile.simElevation.base
  const points = new Map<string, PointTruth>()
  const windEvent =
    resort.id === WIND_EVENT.resortId ? { from: regionMs(region, WIND_EVENT.from), to: regionMs(region, WIND_EVENT.to) } : null

  for (const def of resort.weatherPoints.filter((p) => p.key === 'base' || p.key === 'summit')) {
    const summit = def.key === 'summit'
    const elev = def.elevationM ?? (summit ? resort.summitElevationM : resort.baseElevationM) ?? (summit ? profile.simElevation.summit : profile.simElevation.base)
    const noise = rng(`truth|${resort.id}|${def.key}`)
    let e = 0
    let w = 0
    let depth = INITIAL_DEPTH_M[region][summit ? 'summit' : 'base']
    const ctx: PointContext = { elevationM: elev, summit, tz }
    const raw: RawHour[] = []
    const hourly: HourlyWeather[] = []
    for (const ms of stampMs) {
      const k = gridIndex(ms)
      e = 0.8 * e + noise.normal(0, 0.25)
      w = 0.7 * w + noise.normal(0, 1.2)
      const cloud = clamp(drivers.cloud[k] + noise.normal(0, 3), 0, 100)
      const amp = c.diurnalAmpC * (1 - 0.6 * (cloud / 100)) * (summit ? 0.6 : 1)
      const tempC = climoC(region, ms) + drivers.anomaly[k] + amp * diurnalShape(localHour(ms, tz)) + profile.tempOffsetC + (c.refElevM - elev) * LAPSE_C_PER_M + e
      const oro = 1 + (0.25 * (elev - baseElev)) / 1000
      const waterMm = (drivers.water[k] * profile.snowFactor + (profile.lakeEffect ? drivers.lake[k] : 0)) * Math.max(0.5, oro)
      let windKmh = (drivers.wind[k] * profile.windFactor + w) * (summit ? c.summitWindMult : 1) + (summit ? 4 : 0)
      let gustRatio = (summit ? 1.55 : 1.45) + 0.08 * Math.tanh(noise.normal(0, 1))
      if (windEvent && ms >= windEvent.from && ms <= windEvent.to) {
        const bump = Math.sin((Math.PI * (ms - windEvent.from)) / (windEvent.to - windEvent.from))
        const [lo, span] = summit ? WIND_EVENT.summitKmh : WIND_EVENT.baseKmh
        windKmh = Math.max(windKmh, lo + span * bump)
        gustRatio = 1.6
      }
      const r: RawHour = { tempC, waterMm, windKmh: Math.max(1, windKmh), gustRatio, cloudPct: cloud, humidityPct: clamp(drivers.humidity[k] + noise.normal(0, 2), 30, 100) }
      raw.push(r)
      const h = deriveHour(ms, r, ctx)
      depth = stepSnowDepth(depth, h)
      hourly.push({ ...h, snowDepthM: round(depth, 3) })
    }
    points.set(def.key, { def, simElevationM: elev, raw, hourly })
  }
  return { resortId: resort.id, tz, region, profile, firstMs, stampMs, points, anomaly }
}

/** Index of a stamp in the truth series (−1 when outside). */
export function stampIndex(truth: Pick<ResortTruth, 'firstMs' | 'stampMs'>, ms: number): number {
  const i = Math.round((ms - truth.firstMs) / HOUR_MS)
  return i >= 0 && i < truth.stampMs.length ? i : -1
}

/** Sum of a per-stamp series over (fromMs, toMs] (preceding-hour stamps). Null when the window is not fully covered. */
export function sumWindow(truth: Pick<ResortTruth, 'firstMs' | 'stampMs'>, values: readonly number[], fromMs: number, toMs: number): number | null {
  const a = stampIndex(truth, fromMs + HOUR_MS)
  const b = stampIndex(truth, toMs)
  if (a < 0 || b < 0 || b < a) return null
  let s = 0
  for (let i = a; i <= b; i++) s += values[i]
  return s
}

// ---------------------------------------------------------------------------
// Forecast runs

export interface ForecastRun {
  resortId: string
  fetchedAt: string
  /** Number of forecast days counting the fetch day (Open-Meteo forecast_days). */
  horizonDays: number
  pastDays: number
  points: Map<string, HourlyWeather[]>
}

interface LeadErrors {
  tempBias: number
  shiftH: number
  precipFactor: number
  windFactor: number
}

/**
 * A forecast fetched at `fetchedAt` covering resort-local days [fetch day − pastDays, fetch day + horizonDays − 1]
 * (clipped to the simulated window, so nothing precedes the tracking start). Hours before the fetch time are the
 * truth (a model's analysis of the past); later hours carry lead-dependent errors.
 */
export function forecastRun(truth: ResortTruth, fetchedAt: string, opts: { pastDays: number; horizonDays: number }): ForecastRun {
  const tz = truth.tz
  const fetchedMs = Date.parse(fetchedAt)
  const today = DateTime.fromMillis(fetchedMs, { zone: tz }).toISODate()!
  const fromDay = DateTime.fromISO(today, { zone: 'UTC' }).minus({ days: opts.pastDays }).toISODate()!
  const toDay = DateTime.fromISO(today, { zone: 'UTC' }).plus({ days: opts.horizonDays - 1 }).toISODate()!
  const [a, b] = stampRange(fromDay, toDay, tz)
  const first = Math.max(0, stampIndex(truth, Math.max(a, truth.firstMs)))
  const lastIdx = stampIndex(truth, Math.min(b, truth.stampMs[truth.stampMs.length - 1]))

  const zr = rng(`fc|${truth.region}|${fetchedAt}`)
  const zs = rng(`fc|${truth.resortId}|${fetchedAt}`)
  const z = () => 0.94 * zr.normal() + 0.34 * zs.normal()
  const zT = z()
  const zS = z()
  const zP = z()
  const zW = z()
  const errors = (leadH: number): LeadErrors => {
    const d = leadH / 24
    return {
      tempBias: 0.9 * zT * Math.sqrt(d),
      shiftH: clamp(Math.round(2.2 * zS * d), -30, 30),
      precipFactor: Math.exp(0.28 * zP * Math.sqrt(d)),
      windFactor: Math.exp(0.12 * zW * Math.sqrt(d)),
    }
  }
  const drivers = regionDrivers(truth.region)
  const busts = drivers.storms.flatMap((s) => (s.bust ?? []).filter((x) => x.fetchedAt === fetchedAt).map((x) => ({ from: s.startMs, to: s.endMs + HOUR_MS, factor: x.factor })))

  const points = new Map<string, HourlyWeather[]>()
  for (const [key, pt] of truth.points) {
    const ctx: PointContext = { elevationM: pt.simElevationM, summit: key === 'summit', tz }
    const noise = rng(`fcn|${truth.resortId}|${key}|${fetchedAt}`)
    let e = 0
    let depth = 0
    const out: HourlyWeather[] = []
    for (let j = first; j <= lastIdx; j++) {
      const ms = truth.stampMs[j]
      if (ms <= fetchedMs) {
        out.push(pt.hourly[j])
        depth = pt.hourly[j].snowDepthM ?? 0
        continue
      }
      if (out.length === 0) depth = j > 0 ? (pt.hourly[j - 1].snowDepthM ?? 0) : 0
      const leadH = (ms - fetchedMs) / HOUR_MS
      const d = leadH / 24
      const err = errors(leadH)
      const bust = busts.find((x) => ms > x.from && ms <= x.to)
      const js = bust ? j : clamp(j + err.shiftH, 0, truth.stampMs.length - 1)
      const pf = bust ? bust.factor : err.precipFactor
      e = 0.85 * e + noise.normal(0, 0.2 * Math.min(1, Math.sqrt(d)))
      const src = pt.raw[js]
      let tempC = pt.raw[j].tempC + err.tempBias + e
      let waterMm = src.waterMm
      if (d > 7) {
        // Trend days: pull the anomaly toward climatology and smear precipitation in time.
        tempC -= truth.anomaly[j] * Math.min(0.6, (d - 7) / 12)
        let sum = 0
        let n = 0
        for (let i = Math.max(0, js - 6); i <= Math.min(truth.stampMs.length - 1, js + 6); i++) {
          sum += pt.raw[i].waterMm
          n++
        }
        waterMm = sum / n
      }
      const raw: RawHour = {
        tempC,
        waterMm: waterMm * pf,
        windKmh: src.windKmh * err.windFactor,
        gustRatio: src.gustRatio,
        cloudPct: src.cloudPct,
        humidityPct: src.humidityPct,
      }
      const h = deriveHour(ms, raw, ctx)
      depth = stepSnowDepth(depth, h)
      out.push({ ...h, snowDepthM: round(depth, 3) })
    }
    points.set(key, out)
  }
  return { resortId: truth.resortId, fetchedAt, horizonDays: opts.horizonDays, pastDays: opts.pastDays, points }
}

/** Open-Meteo-style variable names and units for the simulated runs. */
export const DEMO_UNITS: Record<string, string> = {
  temperature_2m: '°C',
  apparent_temperature: '°C',
  snowfall: 'cm',
  rain: 'mm',
  precipitation: 'mm',
  wind_speed_10m: 'km/h',
  wind_gusts_10m: 'km/h',
  relative_humidity_2m: '%',
  visibility: 'm',
  cloud_cover: '%',
  freezing_level_height: 'm',
  snow_depth: 'm',
  weather_code: 'wmo code',
  is_day: '',
}
export const DEMO_VARIABLES = Object.keys(DEMO_UNITS)
