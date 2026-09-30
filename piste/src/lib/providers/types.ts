/**
 * Provider contracts. Every adapter returns values together with provenance and an explicit statement of which
 * fields it could and could not supply — never a bare bag of values. Adapters are pure with respect to the
 * database: jobs (src/lib/jobs) persist what adapters return.
 */
import type { DataKind, OperatingStatus, Provenance, SnowfallReading, SurfaceTag } from '@/lib/domain/types'
import type { SkiAreaExtract } from '@/lib/domain/lifts'

export interface Capabilities {
  /** Fields/variables this call actually returned with values. */
  supplied: string[]
  /** Fields/variables requested or expected but unavailable (kept null downstream). */
  missing: string[]
  /** Free-text limitations to show users (e.g. "grid cell ≈ 9 km; elevation-adjusted only"). */
  limitations: string[]
}

export interface SourceFetch {
  url: string
  fetchedAt: string
  httpStatus: number | null
  contentHash: string | null
  /** Small permitted extract for debugging/change detection — not a full page copy. */
  extract?: unknown
  /** Outcome of this request (after retries). Absent on legacy records. */
  ok?: boolean
  /** Short error text when `ok` is false. Never contains credentials. */
  error?: string | null
  /** Number of network attempts made (0 when served from the in-memory cache). */
  attempts?: number
  /** Served from the short-lived in-memory cache; `fetchedAt` is the ORIGINAL retrieval time. */
  fromCache?: boolean
}

export type ProviderResult<T> =
  | { ok: true; data: T; provenance: Provenance; capabilities: Capabilities; fetches: SourceFetch[] }
  | {
      ok: false
      error: string
      /** 'timeout' | 'http' | 'network' | 'parse' | 'schema-changed' | 'unsupported' | 'not-configured' | 'rate-limited' */
      errorKind: ProviderErrorKind
      retriable: boolean
      fetches: SourceFetch[]
    }

export type ProviderErrorKind =
  | 'timeout'
  | 'http'
  | 'network'
  | 'parse'
  | 'schema-changed'
  | 'unsupported'
  | 'not-configured'
  | 'rate-limited'

// ---------------------------------------------------------------------------
// Weather

export interface WeatherPointRequest {
  resortId: string
  pointKey: string // 'base' | 'summit'
  lat: number
  lon: number
  elevationM: number | null
  timezone: string // resort IANA zone (used for local-date bucketing)
  country: string
}

export interface HourlyWeather {
  /** UTC ISO instant labelling the hour, exactly as the provider timestamps it. */
  validTime: string
  temperatureC: number | null
  apparentTemperatureC: number | null
  /** Snowfall accumulation (cm) over the provider's documented interval (see `intervalSemantics`). */
  snowfallCm: number | null
  rainMm: number | null
  precipitationMm: number | null
  windKmh: number | null
  gustKmh: number | null
  humidityPct: number | null
  visibilityM: number | null
  cloudCoverPct: number | null
  freezingLevelM: number | null
  /** Modeled snow depth on the ground (m) — NOT a piste base depth. */
  snowDepthM: number | null
  weatherCode: number | null
  isDay: boolean | null
}

export interface WeatherSeries {
  provider: string
  model: string | null
  kind: Extract<DataKind, 'modeled' | 'observed' | 'demo'>
  /** How accumulations relate to `validTime`: Open-Meteo sums cover the PRECEDING hour. */
  intervalSemantics: 'preceding-hour' | 'following-hour' | 'instant'
  requested: { lat: number; lon: number; elevationM: number | null }
  grid: { lat: number | null; lon: number | null; elevationM: number | null }
  modelRunAt: string | null
  horizonDays: number
  hourly: HourlyWeather[]
  units: Record<string, string>
}

export interface WeatherProvider {
  id: string
  label: string
  supports(req: WeatherPointRequest): boolean
  fetchForecast(req: WeatherPointRequest, opts?: { pastDays?: number; forecastDays?: number }): Promise<ProviderResult<WeatherSeries>>
}

export interface OfficialAlert {
  id: string
  event: string
  headline: string | null
  severity: string | null
  /** UTC ISO instants. `ends` null = the issuer gave no end (treat as unbounded, never as "over"). */
  onset: string | null
  ends: string | null
  url: string | null
  /** When the alert message itself expires (UTC ISO). Distinct from `ends` (end of the hazard). */
  expires?: string | null
  /** Issuer's affected-area description. */
  areaDesc?: string | null
}

export interface AlertsProvider {
  id: string
  supports(req: { lat: number; lon: number; country: string }): boolean
  fetchActiveAlerts(req: { lat: number; lon: number; country: string }): Promise<ProviderResult<OfficialAlert[]>>
}

// ---------------------------------------------------------------------------
// Official resort reports

export interface ParsedReport {
  localDate: string
  reportedAt: string | null
  status: OperatingStatus | null
  snowfall: SnowfallReading[]
  baseDepthCm: number | null
  baseDepthLocation: string | null
  summitDepthCm: number | null
  surfaceTags: SurfaceTag[]
  surfaceText: string | null
  groomingText: string | null
  groomedRuns: number | null
  snowmakingText: string | null
  openTrails: number | null
  totalTrails: number | null
  openLifts: number | null
  totalLifts: number | null
  openBeginnerTrails: number | null
  totalBeginnerTrails: number | null
  openAcres: number | null
  notes: string | null
}

export interface ResortReportProvider {
  id: string // e.g. 'greek-peak-official'
  resortId: string
  label: string
  /** 'verified' = developed against the live source; 'unverified' = built without access, expect breakage. */
  maturity: 'verified' | 'unverified'
  url: string
  fetchReport(ctx: { now: string; timezone: string }): Promise<ProviderResult<ParsedReport>>
}

// ---------------------------------------------------------------------------
// Lifts and runs (community map data — never live status)

export interface SkiAreaRequest {
  resortId: string
  /** Names the ski area may be mapped under (the resort's name and short name). */
  names: string[]
  country: string
  /** Where to look: Piste's base and summit weather points. */
  points: { lat: number; lon: number }[]
}

export interface SkiAreaProvider {
  id: string
  label: string
  /** Endpoint every request goes to (recorded as the fetch URL). */
  endpoint: string
  fetchSkiArea(req: SkiAreaRequest): Promise<ProviderResult<SkiAreaExtract>>
}

// ---------------------------------------------------------------------------
// Passes, events, travel, lodging, FX

export interface PassProvider {
  id: string
  /** Pass products and rules are curated manual records unless an adapter can read a documented source. */
  mode: 'manual' | 'adapter'
}

export interface EventProvider {
  id: string
  mode: 'manual' | 'adapter'
}

export interface FlightOfferQuery {
  origin: string
  destination: string
  departDate: string
  returnDate: string | null
  adults: number
  cabin: 'economy' | 'premium_economy' | 'business' | 'first'
}

export interface FlightOffer {
  id: string
  totalAmountMinor: number
  currency: string
  expiresAt: string | null
  owner: string | null
  slices: {
    origin: string
    destination: string
    departAt: string
    arriveAt: string
    segments: {
      carrier: string
      flightNumber: string
      origin: string
      destination: string
      /** UTC ISO instant when the airport zone is known; otherwise the airport-local wall time (see `departLocal`). */
      departAt: string
      arriveAt: string
      /** Airport-local wall-clock time exactly as the provider stated it ('YYYY-MM-DDTHH:mm:ss'). */
      departLocal?: string | null
      arriveLocal?: string | null
      carrierName?: string | null
      operatingCarrier?: string | null
    }[]
  }[]
  baggageNotes: string | null
  testMode: boolean
}

export interface TravelProvider {
  id: string
  configured(): boolean
  searchOffers(q: FlightOfferQuery): Promise<ProviderResult<FlightOffer[]>>
}

export interface LodgingProvider {
  id: string
  mode: 'manual' | 'adapter'
}

export interface FxQuote {
  base: string
  quote: string
  rate: string // decimal string
  rateDate: string
}

export interface FxProvider {
  id: string
  fetchRates(base: string, quotes: string[]): Promise<ProviderResult<FxQuote[]>>
}

export interface LinkCheckResult {
  url: string
  ok: boolean
  httpStatus: number | null
  finalUrl: string | null
  embeddable: boolean | null
  error: string | null
  checkedAt: string
}
