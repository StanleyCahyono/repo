/**
 * Fixtures for job tests: an in-memory database with minimal resorts and fake providers in the recorded
 * (normalised) formats of the real adapters. Not imported by production code.
 */
import { createMemoryDb, type Db } from '@/lib/db/client'
import { favorites, resorts, resortSeasons, seasons, userPreferences } from '@/lib/db/schema'
import type { ResortRow } from '@/lib/db/rows'
import { defaultPreferences } from '@/lib/domain/defaults'
import { addHours } from '@/lib/domain/time'
import { provenance } from '@/lib/domain/types'
import type {
  AlertsProvider,
  HourlyWeather,
  OfficialAlert,
  ParsedReport,
  ProviderErrorKind,
  ProviderResult,
  ResortReportProvider,
  WeatherPointRequest,
  WeatherProvider,
  WeatherSeries,
} from '@/lib/providers/types'
import { emptyDeps, type JobDeps } from './types'

export async function testDb(): Promise<Db> {
  return (await createMemoryDb()).db
}

export const T0 = '2027-01-15T14:00:00.000Z'

export async function addResort(db: Db, r: Partial<ResortRow> & { id: string }, opts: { favorite?: boolean } = {}): Promise<ResortRow> {
  const row: ResortRow = {
    name: r.id,
    shortName: r.id,
    country: 'US',
    region: 'test',
    stateProvince: null,
    locality: null,
    timezone: 'America/Denver',
    operator: null,
    lat: 40.59,
    lon: -111.64,
    locationProv: null,
    baseElevationM: 2600,
    summitElevationM: 3200,
    verticalM: 600,
    elevationProv: null,
    terrain: null,
    features: null,
    character: null,
    learning: null,
    links: {},
    weatherPoints: [
      { key: 'base', label: 'Base', lat: 40.59, lon: -111.64, elevationM: 2600 },
      { key: 'summit', label: 'Summit', lat: 40.58, lon: -111.63, elevationM: 3200 },
    ],
    reportSource: null,
    research: null,
    photo: null,
    priority: 0,
    origin: 'catalog',
    createdAt: T0,
    updatedAt: T0,
    ...r,
  }
  await db.insert(resorts).values(row)
  if (opts.favorite) await db.insert(favorites).values({ resortId: row.id, addedAt: T0, sortOrder: 0 })
  return row
}

export async function addPrefs(db: Db, now = T0) {
  await db.insert(userPreferences).values(defaultPreferences(now)).onConflictDoNothing()
}

export async function addSeason(db: Db, resortId: string, v: Partial<typeof resortSeasons.$inferInsert> = {}) {
  await db.insert(seasons).values({ id: '2026-27', label: '2026–27', startDate: '2026-07-01', endDate: '2027-06-30' }).onConflictDoNothing()
  await db.insert(resortSeasons).values({ resortId, seasonId: '2026-27', updatedAt: T0, ...v })
}

export function blankHour(validTime: string): HourlyWeather {
  return {
    validTime,
    temperatureC: null,
    apparentTemperatureC: null,
    snowfallCm: null,
    rainMm: null,
    precipitationMm: null,
    windKmh: null,
    gustKmh: null,
    humidityPct: null,
    visibilityM: null,
    cloudCoverPct: null,
    freezingLevelM: null,
    snowDepthM: null,
    weatherCode: null,
    isDay: null,
  }
}

export const FAIR: Partial<HourlyWeather> = {
  temperatureC: -4,
  apparentTemperatureC: -7,
  snowfallCm: 0,
  rainMm: 0,
  precipitationMm: 0,
  windKmh: 10,
  gustKmh: 20,
  visibilityM: 20000,
  cloudCoverPct: 20,
}

export function hours(from: string, n: number, fn: (i: number, t: string) => Partial<HourlyWeather> = () => FAIR): HourlyWeather[] {
  return Array.from({ length: n }, (_, i) => {
    const t = addHours(from, i)
    return { ...blankHour(t), ...fn(i, t) }
  })
}

export function series(req: WeatherPointRequest, hourly: HourlyWeather[], extra: Partial<WeatherSeries> = {}): WeatherSeries {
  return {
    provider: 'Open-Meteo',
    model: 'best_match',
    kind: 'modeled',
    intervalSemantics: 'preceding-hour',
    requested: { lat: req.lat, lon: req.lon, elevationM: req.elevationM },
    grid: { lat: req.lat + 0.01, lon: req.lon - 0.01, elevationM: 2550 },
    modelRunAt: null,
    horizonDays: 16,
    hourly,
    units: { temperature_2m: '°C', snowfall: 'cm' },
    ...extra,
  }
}

export function ok<T>(data: T, fetchedAt: string, url = 'https://example.test/api'): ProviderResult<T> {
  return {
    ok: true,
    data,
    provenance: provenance({ kind: 'modeled', provider: 'Open-Meteo', sourceUrl: url, fetchedAt }),
    capabilities: { supplied: ['temperature_2m', 'snowfall'], missing: [], limitations: [] },
    fetches: [{ url, fetchedAt, httpStatus: 200, contentHash: 'h' }],
  }
}

export function fail<T>(error: string, errorKind: ProviderErrorKind = 'timeout', url = 'https://example.test/api'): ProviderResult<T> {
  return { ok: false, error, errorKind, retriable: true, fetches: [{ url, fetchedAt: T0, httpStatus: errorKind === 'http' ? 503 : null, contentHash: null }] }
}

/** A weather provider whose behaviour is swapped per test via `respond`. */
export function fakeWeather(
  respond: (req: WeatherPointRequest) => ProviderResult<WeatherSeries> | Promise<ProviderResult<WeatherSeries>>,
  id = 'open-meteo',
): WeatherProvider & { calls: WeatherPointRequest[] } {
  const calls: WeatherPointRequest[] = []
  return {
    id,
    label: id === 'open-meteo' ? 'Open-Meteo' : id,
    calls,
    supports: () => true,
    async fetchForecast(req) {
      calls.push(req)
      return respond(req)
    },
  }
}

export function fakeAlerts(respond: () => ProviderResult<OfficialAlert[]>): AlertsProvider {
  return { id: 'nws-alerts', supports: () => true, fetchActiveAlerts: async () => respond() }
}

export function parsedReport(v: Partial<ParsedReport> = {}): ParsedReport {
  return {
    localDate: '2027-01-15',
    reportedAt: '2027-01-15T13:00:00.000Z',
    status: 'open',
    snowfall: [{ window: 'overnight', amountCm: 5, sourceText: '2" overnight' }],
    baseDepthCm: 150,
    baseDepthLocation: null,
    summitDepthCm: null,
    surfaceTags: ['packed-powder'],
    surfaceText: 'Packed powder',
    groomingText: '12 runs groomed',
    groomedRuns: 12,
    snowmakingText: null,
    openTrails: 80,
    totalTrails: 116,
    openLifts: 6,
    totalLifts: 7,
    openBeginnerTrails: null,
    totalBeginnerTrails: null,
    openAcres: null,
    notes: null,
    ...v,
  }
}

export function reportResult(data: ParsedReport, fetchedAt: string): ProviderResult<ParsedReport> {
  return {
    ok: true,
    data,
    provenance: provenance({ kind: 'official', provider: 'alta.com', sourceUrl: 'https://www.alta.com/conditions', fetchedAt, verification: 'official-page' }),
    capabilities: { supplied: ['baseDepthCm'], missing: [], limitations: [] },
    fetches: [{ url: 'https://www.alta.com/conditions', fetchedAt, httpStatus: 200, contentHash: `page-${fetchedAt}` }],
  }
}

export function fakeReports(resortId: string, respond: () => ProviderResult<ParsedReport>): ResortReportProvider {
  return {
    id: `${resortId}-official`,
    resortId,
    label: `${resortId} official report`,
    maturity: 'unverified',
    url: 'https://www.alta.com/conditions',
    fetchReport: async () => respond(),
  }
}

export function deps(over: Partial<JobDeps> = {}): JobDeps {
  return emptyDeps({ sleep: async () => {}, ...over })
}
