/**
 * National Weather Service API (https://www.weather.gov/documentation/services-web-api), US only.
 *
 * - Alerts: GET /alerts/active?point=lat,lon → official watches/warnings/advisories (kind 'official').
 *   Only `status: "Actual"` messages are kept; test/exercise/system messages are dropped and counted.
 * - Gridpoint forecast (second model for disagreement checks): GET /points/{lat},{lon} → `forecastGridData`
 *   URL → GET that grid. Layers are ISO-8601 intervals and are spread onto UTC hours by `nws-intervals.ts`
 *   (accumulations proportionally, instantaneous values repeated; hours covered by overlapping accumulation
 *   intervals stay null). Records are stamped at the hour START and describe [T, T+1h) → intervalSemantics
 *   'following-hour'.
 * - Timestamps (alert onset/ends/expires, grid updateTime, interval bounds) must carry an offset; an offset-less
 *   stamp is treated as unknown (null), never read in the server's zone.
 *
 * NWS requires every client to identify itself via User-Agent (set by http.ts from PISTE_CONTACT) and asks for
 * caching: the point→grid lookup is cached for 24 h, grid data for 10 min. Coordinates are sent with at most four
 * decimals (the API redirects otherwise).
 */
import { z } from 'zod'
import { provenance } from '@/lib/domain/types'
import { fToC, ftToM, mphToKmh } from '@/lib/domain/units'
import { defaultHttp, redactUrl, type HttpClient } from '../http'
import { addHoursIso, caps, describeIssues, fail, failFromHttp, toUtcIso } from '../result'
import type {
  AlertsProvider,
  HourlyWeather,
  OfficialAlert,
  ProviderResult,
  SourceFetch,
  WeatherPointRequest,
  WeatherProvider,
  WeatherSeries,
} from '../types'
import { distributeToHours, HOUR_MS, type LayerKind, type NwsValue } from './nws-intervals'

export const NWS_BASE = 'https://api.weather.gov'
const GEO_JSON = { Accept: 'application/geo+json' }

const coord = (v: number) => String(Number(v.toFixed(4)))

export function nwsSupports(req: { lat: number; lon: number; country: string }): boolean {
  return req.country.toUpperCase() === 'US' && Number.isFinite(req.lat) && Number.isFinite(req.lon) && Math.abs(req.lat) <= 90 && Math.abs(req.lon) <= 180
}

// ---------------------------------------------------------------------------
// Alerts

const AlertsSchema = z.object({
  features: z.array(
    z.object({
      id: z.string().optional(),
      properties: z.object({
        '@id': z.string().optional(),
        id: z.string().optional(),
        event: z.string(),
        headline: z.string().nullable().optional(),
        severity: z.string().nullable().optional(),
        onset: z.string().nullable().optional(),
        ends: z.string().nullable().optional(),
        expires: z.string().nullable().optional(),
        areaDesc: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        messageType: z.string().nullable().optional(),
      }),
    }),
  ),
})

export function parseNwsAlerts(json: unknown): { ok: true; alerts: OfficialAlert[]; dropped: number } | { ok: false; error: string } {
  const parsed = AlertsSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: describeIssues(parsed.error.issues) }
  let dropped = 0
  const alerts: OfficialAlert[] = []
  for (const f of parsed.data.features) {
    const p = f.properties
    if ((p.status ?? 'Actual') !== 'Actual' || p.messageType === 'Cancel') {
      dropped++
      continue
    }
    const id = p.id ?? f.id ?? p['@id']
    if (!id) {
      dropped++
      continue
    }
    const link = p['@id'] ?? f.id ?? null
    alerts.push({
      id,
      event: p.event,
      headline: p.headline ?? null,
      severity: p.severity ?? null,
      onset: toUtcIso(p.onset),
      ends: toUtcIso(p.ends),
      url: link && /^https:\/\//.test(link) ? link : null,
      expires: toUtcIso(p.expires),
      areaDesc: p.areaDesc ?? null,
    })
  }
  return { ok: true, alerts, dropped }
}

export function createNwsAlertsProvider(options: { http?: HttpClient } = {}): AlertsProvider {
  return {
    id: 'nws-alerts',
    supports: nwsSupports,
    async fetchActiveAlerts(req): Promise<ProviderResult<OfficialAlert[]>> {
      if (!nwsSupports(req)) return fail('unsupported', 'NWS alerts cover US locations only')
      const url = `${NWS_BASE}/alerts/active?point=${coord(req.lat)},${coord(req.lon)}`
      const res = await (options.http ?? defaultHttp).request(url, { expect: 'json', headers: GEO_JSON, timeoutMs: 15_000, retries: 2, cacheTtlMs: 5 * 60_000 })
      if (!res.ok) return failFromHttp(res, [res.fetch], 'NWS alerts')
      const parsed = parseNwsAlerts(res.data)
      if (!parsed.ok) return fail('parse', `NWS alerts: ${parsed.error}`, [{ ...res.fetch, ok: false, error: parsed.error }], false)
      const limitations = ['Official NWS alerts for this point; shown independently of scores.']
      if (parsed.dropped) limitations.push(`${parsed.dropped} test/exercise/cancel message(s) ignored.`)
      return {
        ok: true,
        data: parsed.alerts,
        capabilities: caps(['alerts'], [], limitations),
        fetches: [{ ...res.fetch, extract: { count: parsed.alerts.length, ids: parsed.alerts.map((a) => a.id).slice(0, 10) } }],
        provenance: provenance({
          kind: 'official',
          provider: 'NWS',
          sourceUrl: url,
          fetchedAt: res.fetch.fetchedAt,
          staleAfter: addHoursIso(res.fetch.fetchedAt, 1),
          verification: 'api',
        }),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Gridpoint forecast

const PointsSchema = z.object({
  properties: z.object({
    gridId: z.string(),
    gridX: z.number(),
    gridY: z.number(),
    forecastGridData: z.string(),
    timeZone: z.string().optional(),
  }),
})

const Layer = z.object({
  uom: z.string().optional(),
  values: z.array(z.object({ validTime: z.string(), value: z.number().nullable() })),
})

const GridSchema = z.object({
  geometry: z
    .object({ type: z.string(), coordinates: z.array(z.array(z.array(z.number()))) })
    .nullable()
    .optional(),
  properties: z
    .object({
      updateTime: z.string().optional(),
      elevation: z.object({ unitCode: z.string().optional(), value: z.number().nullable() }).optional(),
      gridId: z.string().optional(),
    })
    .catchall(z.unknown()),
})

type Field = Exclude<keyof HourlyWeather, 'validTime' | 'isDay'>
const id = (v: number) => v
const speed: Record<string, (v: number) => number> = { 'km_h-1': id, 'm_s-1': (v) => v * 3.6, kt: (v) => v * 1.852, 'mi_h-1': mphToKmh }
const temp: Record<string, (v: number) => number> = { degC: id, degF: fToC }

/** NWS layer → canonical field, interval kind and accepted units (uom without the `wmoUnit:` prefix). */
export const NWS_LAYERS: { layer: string; field: Field; kind: LayerKind; units: Record<string, (v: number) => number> }[] = [
  { layer: 'temperature', field: 'temperatureC', kind: 'instant', units: temp },
  { layer: 'apparentTemperature', field: 'apparentTemperatureC', kind: 'instant', units: temp },
  { layer: 'relativeHumidity', field: 'humidityPct', kind: 'instant', units: { percent: id } },
  { layer: 'windSpeed', field: 'windKmh', kind: 'instant', units: speed },
  { layer: 'windGust', field: 'gustKmh', kind: 'instant', units: speed },
  { layer: 'skyCover', field: 'cloudCoverPct', kind: 'instant', units: { percent: id } },
  { layer: 'visibility', field: 'visibilityM', kind: 'instant', units: { m: id, km: (v) => v * 1000, ft: ftToM } },
  { layer: 'snowfallAmount', field: 'snowfallCm', kind: 'sum', units: { mm: (v) => v / 10, cm: id, m: (v) => v * 100 } },
  { layer: 'quantitativePrecipitation', field: 'precipitationMm', kind: 'sum', units: { mm: id, cm: (v) => v * 10 } },
]
/** Canonical fields NWS grid data never supplies (kept null, listed as missing). */
const NWS_NEVER: (keyof HourlyWeather)[] = ['rainMm', 'freezingLevelM', 'snowDepthM', 'weatherCode', 'isDay']

const stripUom = (u: string | undefined) => (u ?? '').replace(/^(wmoUnit|unit|nwsUnit):/, '')

function centroid(geometry: z.infer<typeof GridSchema>['geometry']): { lat: number | null; lon: number | null } {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : undefined
  if (!ring || ring.length === 0) return { lat: null, lon: null }
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 }
}

export interface ParsedNwsGrid {
  hourly: HourlyWeather[]
  units: Record<string, string>
  grid: WeatherSeries['grid']
  updateTime: string | null
  supplied: string[]
  missing: string[]
  limitations: string[]
}

/** Parse forecastGridData JSON into hourly canonical records. `keep` trims to hours in [fromMs, toMs). Pure. */
export function parseNwsGrid(json: unknown, keep: { fromMs: number; toMs: number } | null = null): { ok: true; value: ParsedNwsGrid } | { ok: false; error: string } {
  const parsed = GridSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: describeIssues(parsed.error.issues) }
  const props = parsed.data.properties
  const supplied: string[] = []
  const missing: string[] = [...NWS_NEVER]
  const limitations: string[] = []
  const units: Record<string, string> = {}
  const columns = new Map<Field, Map<number, number | null>>()
  const hours = new Set<number>()

  for (const spec of NWS_LAYERS) {
    const raw = props[spec.layer]
    if (raw === undefined) {
      missing.push(spec.field)
      continue
    }
    const layer = Layer.safeParse(raw)
    if (!layer.success) return { ok: false, error: `${spec.layer}: ${describeIssues(layer.error.issues)}` }
    const uom = stripUom(layer.data.uom)
    const convert = spec.units[uom]
    if (!convert) {
      missing.push(spec.field)
      limitations.push(`Ignored ${spec.layer}: unrecognised unit "${layer.data.uom ?? '(none)'}".`)
      continue
    }
    units[spec.layer] = layer.data.uom ?? uom
    const map = distributeToHours(layer.data.values as NwsValue[], spec.kind, convert)
    for (const h of [...map.keys()]) {
      if (keep && (h < keep.fromMs || h >= keep.toMs)) map.delete(h)
      else hours.add(h)
    }
    columns.set(spec.field, map)
    if ([...map.values()].some((v) => v !== null)) supplied.push(spec.field)
    else missing.push(spec.field)
  }

  const sorted = [...hours].sort((a, b) => a - b)
  const hourly: HourlyWeather[] = sorted.map((h) => {
    const col = (f: Field) => columns.get(f)?.get(h) ?? null
    return {
      validTime: new Date(h).toISOString(),
      temperatureC: col('temperatureC'),
      apparentTemperatureC: col('apparentTemperatureC'),
      snowfallCm: col('snowfallCm'),
      rainMm: null,
      precipitationMm: col('precipitationMm'),
      windKmh: col('windKmh'),
      gustKmh: col('gustKmh'),
      humidityPct: col('humidityPct'),
      visibilityM: col('visibilityM'),
      cloudCoverPct: col('cloudCoverPct'),
      freezingLevelM: null,
      snowDepthM: null,
      weatherCode: null,
      isDay: null,
    }
  })

  let elevationM: number | null = null
  if (props.elevation && props.elevation.value !== null) {
    const u = stripUom(props.elevation.unitCode)
    elevationM = u === 'ft' ? ftToM(props.elevation.value) : u === 'm' || u === '' ? props.elevation.value : null
    if (elevationM !== null) elevationM = Math.round(elevationM * 10) / 10
  }
  const c = centroid(parsed.data.geometry)
  limitations.push(
    'NWS gridded forecast (forecaster-edited model blend on a ~2.5 km grid); modeled, not observed.',
    'Interval totals (snowfall, precipitation) are spread evenly over the hours they cover; partly covered edge hours and hours covered by overlapping intervals are left empty.',
    'Grid position is the centroid of the NWS grid-cell polygon.',
  )
  if (c.lat === null) limitations.push('Grid-cell geometry not supplied.')
  return {
    ok: true,
    value: { hourly, units, grid: { lat: c.lat, lon: c.lon, elevationM }, updateTime: toUtcIso(props.updateTime), supplied, missing, limitations },
  }
}

export function createNwsGridWeatherProvider(options: { http?: HttpClient } = {}): WeatherProvider {
  return {
    id: 'nws-grid',
    label: 'NWS gridded forecast',
    supports: nwsSupports,
    async fetchForecast(req: WeatherPointRequest, opts = {}): Promise<ProviderResult<WeatherSeries>> {
      if (!nwsSupports(req)) return fail('unsupported', 'NWS forecasts cover US locations only')
      const http = options.http ?? defaultHttp
      const fetches: SourceFetch[] = []
      const pointsUrl = `${NWS_BASE}/points/${coord(req.lat)},${coord(req.lon)}`
      const pts = await http.request(pointsUrl, { expect: 'json', headers: GEO_JSON, timeoutMs: 15_000, retries: 2, cacheTtlMs: 24 * 3_600_000 })
      fetches.push(pts.fetch)
      if (!pts.ok) {
        if (pts.status === 404) return fail('unsupported', 'NWS has no forecast grid for this point', fetches, false)
        return failFromHttp(pts, fetches, 'NWS points')
      }
      const points = PointsSchema.safeParse(pts.data)
      if (!points.success) return fail('parse', `NWS points: ${describeIssues(points.error.issues)}`, fetches, false)
      const gridUrl = points.data.properties.forecastGridData
      // Never follow an API-supplied URL off the documented host.
      if (!gridUrl.startsWith(`${NWS_BASE}/gridpoints/`)) return fail('parse', `NWS points returned an unexpected grid URL`, fetches, false)

      const grid = await http.request(gridUrl, { expect: 'json', headers: GEO_JSON, timeoutMs: 20_000, retries: 2, cacheTtlMs: 10 * 60_000 })
      fetches.push(grid.fetch)
      if (!grid.ok) return failFromHttp(grid, fetches, 'NWS grid data')

      const fetchedAt = grid.fetch.fetchedAt
      const nowMs = Date.parse(fetchedAt)
      const forecastDays = Math.min(7, Math.max(1, Math.trunc(opts.forecastDays ?? 7)))
      const pastDays = Math.min(7, Math.max(0, Math.trunc(opts.pastDays ?? 1)))
      const keep = Number.isFinite(nowMs)
        ? { fromMs: Math.floor(nowMs / HOUR_MS) * HOUR_MS - pastDays * 24 * HOUR_MS, toMs: nowMs + forecastDays * 24 * HOUR_MS }
        : null
      const parsed = parseNwsGrid(grid.data, keep)
      if (!parsed.ok) {
        fetches[fetches.length - 1] = { ...grid.fetch, ok: false, error: parsed.error }
        return fail('parse', `NWS grid data: ${parsed.error}`, fetches, false)
      }
      const v = parsed.value
      const { gridId, gridX, gridY } = points.data.properties
      fetches[fetches.length - 1] = { ...grid.fetch, extract: { gridId, gridX, gridY, hours: v.hourly.length, updateTime: v.updateTime } }
      const lastMs = v.hourly.length ? Date.parse(v.hourly.at(-1)!.validTime) + HOUR_MS : null
      const horizonDays = lastMs !== null && Number.isFinite(nowMs) ? Math.max(0, Math.ceil((lastMs - nowMs) / (24 * HOUR_MS))) : 0
      return {
        ok: true,
        data: {
          provider: 'nws',
          model: `NWS ${gridId} gridpoint ${gridX},${gridY}`,
          kind: 'modeled',
          intervalSemantics: 'following-hour',
          requested: { lat: req.lat, lon: req.lon, elevationM: req.elevationM },
          grid: v.grid,
          // `updateTime` is the office's grid issue/update time as supplied by the API — not inferred.
          modelRunAt: v.updateTime,
          horizonDays,
          hourly: v.hourly,
          units: v.units,
        },
        capabilities: caps(v.supplied, v.missing, [
          ...v.limitations,
          ...(req.elevationM !== null && v.grid.elevationM !== null
            ? [`Grid-cell elevation ${v.grid.elevationM} m vs requested point ${req.elevationM} m; NWS does not adjust to the point.`]
            : []),
        ]),
        fetches,
        provenance: provenance({
          kind: 'modeled',
          provider: 'NWS',
          sourceUrl: redactUrl(gridUrl),
          publishedAt: v.updateTime,
          fetchedAt,
          validFrom: v.hourly[0]?.validTime ?? null,
          validTo: lastMs !== null ? new Date(lastMs).toISOString() : null,
          staleAfter: addHoursIso(fetchedAt, 6),
          verification: 'api',
        }),
      }
    },
  }
}

export const nwsAlertsProvider: AlertsProvider = createNwsAlertsProvider()
export const nwsGridWeatherProvider: WeatherProvider = createNwsGridWeatherProvider()
