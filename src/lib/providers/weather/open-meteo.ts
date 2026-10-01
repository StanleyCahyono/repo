/**
 * Open-Meteo forecast adapter (https://open-meteo.com/en/docs).
 *
 * Request choices
 * - `timezone=GMT` + `timeformat=unixtime`: every timestamp is an unambiguous UTC instant. Resort-local days are
 *   computed later with the resort's IANA zone (src/lib/domain/time.ts), never by the API.
 * - `elevation=<m>` when the point elevation is known. Open-Meteo then applies statistical downscaling (a lapse-
 *   rate adjustment from the model grid to that elevation). It does NOT create an independent station and does not
 *   resolve individual slopes. Without it Open-Meteo uses its 90 m terrain model for the grid point.
 * - `wind_speed_unit=kmh`; other units are left at the metric defaults. Returned `hourly_units` are still checked
 *   and converted explicitly; an unrecognised unit makes that variable missing rather than guessed.
 *
 * Interval semantics (Open-Meteo docs): precipitation, rain and snowfall are sums over the PRECEDING hour; wind
 * gusts are the maximum of the preceding hour; temperature, wind speed, humidity, cloud cover, visibility,
 * freezing level and snow depth are instantaneous values at the timestamp.
 *
 * `generationtime_ms` is the API's response-generation duration, not a model run time, so `modelRunAt` stays null.
 *
 * Terms: free API is for non-commercial use; attribution "Weather data by Open-Meteo.com" (CC BY 4.0) is required.
 * With OPEN_METEO_API_KEY the customer endpoint is used; the key is redacted from every stored URL.
 */
import { DateTime } from 'luxon'
import { z } from 'zod'
import { provenance } from '@/lib/domain/types'
import { fToC, ftToM, inToCm, mphToKmh } from '@/lib/domain/units'
import { defaultHttp, redactUrl, type HttpClient } from '../http'
import { addHoursIso, caps, describeIssues, fail, failFromHttp } from '../result'
import type { Capabilities, HourlyWeather, ProviderResult, WeatherPointRequest, WeatherProvider, WeatherSeries } from '../types'

export const OPEN_METEO_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0)'
export const OPEN_METEO_FREE_URL = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_CUSTOMER_URL = 'https://customer-api.open-meteo.com/v1/forecast'
export const OPEN_METEO_MAX_FORECAST_DAYS = 16
export const OPEN_METEO_MAX_PAST_DAYS = 92

export const OPEN_METEO_HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'rain',
  'snowfall',
  'snow_depth',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_gusts_10m',
  'relative_humidity_2m',
  'freezing_level_height',
  'is_day',
] as const
export type OpenMeteoVariable = (typeof OPEN_METEO_HOURLY)[number]

type NumericField = Exclude<keyof HourlyWeather, 'validTime' | 'isDay'>
type Converter = (v: number) => number

const id: Converter = (v) => v
/** Unit table: provider unit string → converter into the canonical field unit. Unknown unit ⇒ variable missing. */
const VARIABLES: Record<Exclude<OpenMeteoVariable, 'is_day'>, { field: NumericField; units: Record<string, Converter> }> = {
  temperature_2m: { field: 'temperatureC', units: { '°C': id, '°F': fToC } },
  apparent_temperature: { field: 'apparentTemperatureC', units: { '°C': id, '°F': fToC } },
  precipitation: { field: 'precipitationMm', units: { mm: id, inch: (v) => v * 25.4 } },
  rain: { field: 'rainMm', units: { mm: id, inch: (v) => v * 25.4 } },
  snowfall: { field: 'snowfallCm', units: { cm: id, mm: (v) => v / 10, inch: inToCm } },
  snow_depth: { field: 'snowDepthM', units: { m: id, cm: (v) => v / 100, ft: ftToM } },
  weather_code: { field: 'weatherCode', units: { 'wmo code': id } },
  cloud_cover: { field: 'cloudCoverPct', units: { '%': id } },
  visibility: { field: 'visibilityM', units: { m: id, ft: ftToM } },
  wind_speed_10m: { field: 'windKmh', units: { 'km/h': id, 'm/s': (v) => v * 3.6, 'mp/h': mphToKmh, mph: mphToKmh, kn: (v) => v * 1.852 } },
  wind_gusts_10m: { field: 'gustKmh', units: { 'km/h': id, 'm/s': (v) => v * 3.6, 'mp/h': mphToKmh, mph: mphToKmh, kn: (v) => v * 1.852 } },
  relative_humidity_2m: { field: 'humidityPct', units: { '%': id } },
  freezing_level_height: { field: 'freezingLevelM', units: { m: id, ft: ftToM } },
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000

const ResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().nullable().optional(),
  generationtime_ms: z.number().optional(),
  utc_offset_seconds: z.number().optional(),
  timezone: z.string().optional(),
  hourly_units: z.record(z.string(), z.string()),
  hourly: z.object({ time: z.array(z.number().int()) }).catchall(z.array(z.union([z.number(), z.null()]))),
})
export type OpenMeteoResponse = z.infer<typeof ResponseSchema>

const ErrorSchema = z.object({ error: z.literal(true), reason: z.string() })

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = v === undefined || !Number.isFinite(v) ? def : Math.trunc(v)
  return Math.min(max, Math.max(min, n))
}

function qs(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/g, ',')}`)
    .join('&')
}

export function buildOpenMeteoUrl(
  req: Pick<WeatherPointRequest, 'lat' | 'lon' | 'elevationM'>,
  o: { pastDays: number; forecastDays: number; apiKey?: string | null },
): string {
  const params: Record<string, string | number> = {
    latitude: round4(req.lat),
    longitude: round4(req.lon),
  }
  if (req.elevationM !== null && Number.isFinite(req.elevationM)) params.elevation = Math.round(req.elevationM)
  params.hourly = OPEN_METEO_HOURLY.join(',')
  params.timezone = 'GMT'
  params.timeformat = 'unixtime'
  params.wind_speed_unit = 'kmh'
  params.forecast_days = o.forecastDays
  params.past_days = o.pastDays
  if (o.apiKey) params.apikey = o.apiKey
  return `${o.apiKey ? OPEN_METEO_CUSTOMER_URL : OPEN_METEO_FREE_URL}?${qs(params)}`
}

export interface ParsedOpenMeteo {
  hourly: HourlyWeather[]
  grid: WeatherSeries['grid']
  units: Record<string, string>
  capabilities: Capabilities
}

/** Parse + normalise a documented-format Open-Meteo forecast response. Pure; exported for tests. */
export function parseOpenMeteo(
  json: unknown,
  req: Pick<WeatherPointRequest, 'lat' | 'lon' | 'elevationM'>,
): { ok: true; value: ParsedOpenMeteo } | { ok: false; error: string } {
  const parsed = ResponseSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: `Unexpected Open-Meteo response: ${describeIssues(parsed.error.issues)}` }
  const r = parsed.data
  if (r.hourly_units.time !== undefined && r.hourly_units.time !== 'unixtime') {
    return { ok: false, error: `Expected unixtime timestamps, got "${r.hourly_units.time}"` }
  }
  const n = r.hourly.time.length
  const limitations: string[] = []
  const supplied: string[] = []
  const missing: string[] = []

  const columns = new Map<NumericField, (number | null)[]>()
  for (const [variable, spec] of Object.entries(VARIABLES) as [Exclude<OpenMeteoVariable, 'is_day'>, (typeof VARIABLES)[keyof typeof VARIABLES]][]) {
    const values = r.hourly[variable] as (number | null)[] | undefined
    if (values === undefined) {
      missing.push(spec.field)
      continue
    }
    if (values.length !== n) return { ok: false, error: `hourly.${variable} has ${values.length} values for ${n} timestamps` }
    const unit = r.hourly_units[variable]
    const convert = unit === undefined ? undefined : spec.units[unit]
    if (!convert) {
      missing.push(spec.field)
      limitations.push(`Ignored ${variable}: unrecognised unit "${unit ?? '(none)'}".`)
      continue
    }
    const out = values.map((v) => (v === null || !Number.isFinite(v) ? null : round4(convert(v))))
    if (out.every((v) => v === null)) missing.push(spec.field)
    else supplied.push(spec.field)
    columns.set(spec.field, out)
  }

  const isDayRaw = r.hourly.is_day as (number | null)[] | undefined
  if (isDayRaw !== undefined && isDayRaw.length !== n) return { ok: false, error: `hourly.is_day has ${isDayRaw.length} values for ${n} timestamps` }
  const isDay = isDayRaw?.map((v) => (v === null ? null : v === 1))
  if (!isDay || isDay.every((v) => v === null)) missing.push('isDay')
  else supplied.push('isDay')

  const hourly: HourlyWeather[] = r.hourly.time.map((t, i) => {
    const col = (f: NumericField) => columns.get(f)?.[i] ?? null
    const code = col('weatherCode')
    return {
      validTime: DateTime.fromSeconds(t, { zone: 'utc' }).toISO()!,
      temperatureC: col('temperatureC'),
      apparentTemperatureC: col('apparentTemperatureC'),
      snowfallCm: col('snowfallCm'),
      rainMm: col('rainMm'),
      precipitationMm: col('precipitationMm'),
      windKmh: col('windKmh'),
      gustKmh: col('gustKmh'),
      humidityPct: col('humidityPct'),
      visibilityM: col('visibilityM'),
      cloudCoverPct: col('cloudCoverPct'),
      freezingLevelM: col('freezingLevelM'),
      snowDepthM: col('snowDepthM'),
      weatherCode: code === null ? null : Math.round(code),
      isDay: isDay?.[i] ?? null,
    }
  })

  const gridElevation = r.elevation ?? null
  limitations.push(
    'Modeled values (Open-Meteo best_match blend of weather models), not station observations.',
    `Values describe the model grid cell at ${r.latitude}, ${r.longitude} (requested ${req.lat}, ${req.lon}), not individual slopes.`,
  )
  if (req.elevationM !== null) {
    limitations.push(
      `Adjusted to ${gridElevation ?? req.elevationM} m by Open-Meteo statistical downscaling (lapse rate); this does not create an independent station.`,
    )
  } else {
    limitations.push(`No point elevation supplied; Open-Meteo used its terrain model elevation (${gridElevation ?? 'unknown'} m).`)
  }
  limitations.push(
    'Snowfall, rain and precipitation are sums over the preceding hour; gusts are the preceding-hour maximum.',
    'snow_depth is modeled ground snow depth, not a groomed piste base.',
  )

  return {
    ok: true,
    value: {
      hourly,
      grid: { lat: r.latitude, lon: r.longitude, elevationM: gridElevation },
      units: { ...r.hourly_units },
      capabilities: caps(supplied, missing, limitations),
    },
  }
}

export interface OpenMeteoOptions {
  http?: HttpClient
  /** Cache identical requests briefly (default 10 min) so repeated manual refreshes do not hammer the API. */
  cacheTtlMs?: number
  /** Per-attempt timeout (default 20 s) and extra attempts (default 2). */
  timeoutMs?: number
  retries?: number
}

export function createOpenMeteoProvider(options: OpenMeteoOptions = {}): WeatherProvider {
  const http = () => options.http ?? defaultHttp
  const supports = (req: Pick<WeatherPointRequest, 'lat' | 'lon'>) =>
    Number.isFinite(req.lat) && Number.isFinite(req.lon) && Math.abs(req.lat) <= 90 && Math.abs(req.lon) <= 180
  return {
    id: 'open-meteo',
    label: 'Open-Meteo',
    supports,
    async fetchForecast(req, opts = {}): Promise<ProviderResult<WeatherSeries>> {
      if (!supports(req)) return fail('unsupported', `Invalid coordinates ${req.lat}, ${req.lon}`)
      const client = http()
      const forecastDays = clampInt(opts.forecastDays, OPEN_METEO_MAX_FORECAST_DAYS, 1, OPEN_METEO_MAX_FORECAST_DAYS)
      const pastDays = clampInt(opts.pastDays, 2, 0, OPEN_METEO_MAX_PAST_DAYS)
      const apiKey = client.env.env().OPEN_METEO_API_KEY?.trim() || null
      const url = buildOpenMeteoUrl(req, { pastDays, forecastDays, apiKey })

      const res = await client.request(url, {
        expect: 'json',
        headers: { Accept: 'application/json' },
        timeoutMs: options.timeoutMs ?? 20_000,
        retries: options.retries ?? 2,
        cacheTtlMs: options.cacheTtlMs ?? 10 * 60_000,
      })
      if (!res.ok) {
        let reason = res.error
        if (res.bodySnippet) {
          try {
            const e = ErrorSchema.safeParse(JSON.parse(res.bodySnippet))
            if (e.success) reason = `${res.error} — ${e.data.reason}`
          } catch {
            /* non-JSON error body */
          }
        }
        return failFromHttp({ ...res, error: reason }, [res.fetch], 'Open-Meteo')
      }
      const parsed = parseOpenMeteo(res.data, req)
      if (!parsed.ok) {
        const fetch = { ...res.fetch, ok: false, error: parsed.error }
        return fail('parse', `Open-Meteo: ${parsed.error}`, [fetch], false)
      }
      const v = parsed.value
      const first = v.hourly[0]?.validTime ?? null
      const last = v.hourly.at(-1)?.validTime ?? null
      const fetchedAt = res.fetch.fetchedAt
      const series: WeatherSeries = {
        provider: 'open-meteo',
        model: 'best_match',
        kind: 'modeled',
        intervalSemantics: 'preceding-hour',
        requested: { lat: req.lat, lon: req.lon, elevationM: req.elevationM },
        grid: v.grid,
        modelRunAt: null,
        horizonDays: forecastDays,
        hourly: v.hourly,
        units: v.units,
      }
      return {
        ok: true,
        data: series,
        capabilities: v.capabilities,
        fetches: [{ ...res.fetch, extract: { grid: v.grid, hours: v.hourly.length, units: v.units } }],
        provenance: provenance({
          kind: 'modeled',
          provider: 'Open-Meteo',
          sourceUrl: redactUrl(url),
          fetchedAt,
          validFrom: first,
          validTo: last,
          staleAfter: addHoursIso(fetchedAt, 6),
          verification: 'api',
          note: OPEN_METEO_ATTRIBUTION,
        }),
      }
    },
  }
}

export const openMeteoProvider: WeatherProvider = createOpenMeteoProvider()
