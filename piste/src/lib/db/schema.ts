/**
 * Piste database schema (SQLite via libsql + Drizzle).
 *
 * Rules of the road
 * - Unknown values are NULL. Never store 0/'' to mean "unknown".
 * - Mutable facts carry a `prov` JSON column (see Provenance in domain/types.ts).
 * - History is appended, not overwritten: status events, report revisions, weather runs, assessments and
 *   price snapshots are separate rows.
 * - Measurements are canonical metric; money is integer minor units + currency.
 * - Timestamps are ISO-8601 UTC strings; resort-local days are YYYY-MM-DD strings.
 */
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import type {
  DataKind,
  DateRange,
  OperatingStatus,
  PassAccessType,
  Provenance,
  ScheduleActivity,
  ScoringMode,
  SnowfallReading,
  SurfaceInterpretation,
  SurfaceTag,
  UnitPrefs,
  AbilityLevel,
  Confidence,
  ScoreKind,
  Eligibility,
} from '@/lib/domain/types'

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()
const bool = (name: string) => integer(name, { mode: 'boolean' })
const createdAt = () => text('created_at').notNull()
const updatedAt = () => text('updated_at').notNull()

// ---------------------------------------------------------------------------
// Catalog

export interface ResortLinks {
  official?: string | null
  trailMap?: string | null
  interactiveMap?: string | null
  snowReport?: string | null
  hours?: string | null
  tickets?: string | null
  seasonPass?: string | null
  lessons?: string | null
  rentals?: string | null
  webcams?: string | null
  parking?: string | null
  roadInfo?: string | null
  lodging?: string | null
  events?: string | null
  tourism?: string | null
  avalanche?: string | null
  openSkiMap?: string | null
  /** Additional useful official/partner pages. */
  more?: { label: string; url: string }[]
}

export interface WeatherPointDef {
  key: 'base' | 'summit' | string
  label: string
  lat: number
  lon: number
  elevationM: number | null
}

export interface TerrainInfo {
  trails: number | null
  lifts: number | null
  skiableAcres: number | null
  beginnerPct: number | null
  intermediatePct: number | null
  advancedPct: number | null
  terrainParks: number | null
  season: string | null
  prov: Provenance | null
}

/** `null` = unknown, `false` = confirmed not offered. */
export interface FeatureInfo {
  nightSkiing: boolean | null
  snowmakingPct: number | null
  lessons: boolean | null
  rentals: boolean | null
  onMountainLodging: boolean | null
  tubing: boolean | null
  childcare: boolean | null
  beginnerArea: string | null
  prov: Provenance | null
}

export interface ReportSourceInfo {
  url: string | null
  format: 'html' | 'json' | 'pdf' | 'unknown'
  adapter: string | null
  notes: string | null
}

export interface ResearchNotes {
  method: string
  date: string
  openQuestions: string[]
  conflicts: string[]
  confidenceNotes: string | null
}

export const resorts = sqliteTable('resorts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  country: text('country').notNull(),
  region: text('region').notNull(),
  stateProvince: text('state_province'),
  locality: text('locality'),
  timezone: text('timezone').notNull(),
  operator: text('operator'),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  locationProv: json<Provenance | null>('location_prov'),
  baseElevationM: real('base_elevation_m'),
  summitElevationM: real('summit_elevation_m'),
  verticalM: real('vertical_m'),
  elevationProv: json<Provenance | null>('elevation_prov'),
  terrain: json<TerrainInfo | null>('terrain'),
  features: json<FeatureInfo | null>('features'),
  character: text('character'),
  learning: text('learning'),
  links: json<ResortLinks>('links').notNull(),
  weatherPoints: json<WeatherPointDef[]>('weather_points').notNull(),
  reportSource: json<ReportSourceInfo | null>('report_source'),
  research: json<ResearchNotes | null>('research'),
  /** Photo with licence metadata; null → designed topographic placeholder. */
  photo: json<{ src: string; alt: string; credit: string; license: string; sourceUrl: string } | null>('photo'),
  priority: integer('priority').notNull().default(0),
  origin: text('origin', { enum: ['catalog', 'user'] }).notNull().default('catalog'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Manual corrections to catalog fields — auditable, never silently lost on reseed. */
export const resortOverrides = sqliteTable('resort_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),
  value: json<unknown>('value'),
  note: text('note'),
  sourceUrl: text('source_url'),
  createdAt: createdAt(),
})

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(), // '2026-27'
  label: text('label').notNull(),
  startDate: text('start_date').notNull(), // nominal, e.g. 2026-10-01
  endDate: text('end_date').notNull(), // e.g. 2027-06-30
})

export const resortSeasons = sqliteTable(
  'resort_seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    seasonId: text('season_id').notNull().references(() => seasons.id),
    announcedOpening: text('announced_opening'), // YYYY-MM-DD target date
    announcedOpeningText: text('announced_opening_text'),
    announcedOpeningOn: text('announced_opening_on'),
    announcedOpeningProv: json<Provenance | null>('announced_opening_prov'),
    estimatedOpenFrom: text('estimated_open_from'),
    estimatedOpenTo: text('estimated_open_to'),
    estimateBasis: text('estimate_basis'),
    actualOpening: text('actual_opening'),
    actualOpeningProv: json<Provenance | null>('actual_opening_prov'),
    announcedClosing: text('announced_closing'),
    announcedClosingText: text('announced_closing_text'),
    announcedClosingProv: json<Provenance | null>('announced_closing_prov'),
    actualClosing: text('actual_closing'),
    actualClosingProv: json<Provenance | null>('actual_closing_prov'),
    typicalOpeningText: text('typical_opening_text'),
    notes: text('notes'),
    lastCheckedAt: text('last_checked_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('resort_seasons_resort_season').on(t.resortId, t.seasonId)],
)

/** History of opening-date changes (announcements are revised; keep every version). */
export const openingDateHistory = sqliteTable('opening_date_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resortId: text('resort_id').notNull(),
  seasonId: text('season_id').notNull(),
  field: text('field', { enum: ['announcedOpening', 'actualOpening', 'announcedClosing', 'actualClosing'] }).notNull(),
  previousValue: text('previous_value'),
  newValue: text('new_value'),
  changedAt: text('changed_at').notNull(),
  prov: json<Provenance | null>('prov'),
})

export const operatingSchedules = sqliteTable(
  'operating_schedules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    seasonId: text('season_id'),
    activity: text('activity').$type<ScheduleActivity>().notNull(),
    label: text('label').notNull(),
    /** ISO weekdays 1=Mon … 7=Sun. */
    daysOfWeek: json<number[] | null>('days_of_week'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    /** Exceptions (holiday hours, closures) apply to one resort-local date and override the weekly pattern. */
    exceptionDate: text('exception_date'),
    opens: text('opens'), // HH:mm resort-local
    closes: text('closes'),
    closed: bool('closed').notNull().default(false),
    /** Published schedule vs a live operations statement. */
    nature: text('nature', { enum: ['published', 'live'] }).notNull().default('published'),
    prov: json<Provenance | null>('prov'),
    updatedAt: updatedAt(),
  },
  (t) => [index('schedules_resort').on(t.resortId)],
)

/** Operating-status changes are appended, never overwritten. */
export const statusEvents = sqliteTable(
  'status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    status: text('status').$type<OperatingStatus>().notNull(),
    effectiveAt: text('effective_at').notNull(),
    localDate: text('local_date').notNull(),
    note: text('note'),
    prov: json<Provenance>('prov').notNull(),
  },
  (t) => [index('status_resort_time').on(t.resortId, t.effectiveAt)],
)

/**
 * Snow / operations report for a resort-local date. Each meaningful change is a new revision.
 * Official, personal (my own feedback), manual (typed from an official source) and demo reports all live here,
 * distinguished by `kind`.
 */
export const operationalReports = sqliteTable(
  'operational_reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    revision: integer('revision').notNull().default(1),
    kind: text('kind').$type<DataKind>().notNull(),
    /** Time the source says it published / updated the report. */
    reportedAt: text('reported_at'),
    fetchedAt: text('fetched_at'),
    status: text('status').$type<OperatingStatus | null>(),
    snowfall: json<SnowfallReading[]>('snowfall').notNull(),
    baseDepthCm: real('base_depth_cm'),
    baseDepthLocation: text('base_depth_location'),
    summitDepthCm: real('summit_depth_cm'),
    surfaceTags: json<SurfaceTag[]>('surface_tags').notNull(),
    /** Source wording, preserved verbatim alongside normalised tags. */
    surfaceText: text('surface_text'),
    groomingText: text('grooming_text'),
    groomedRuns: integer('groomed_runs'),
    snowmakingText: text('snowmaking_text'),
    openTrails: integer('open_trails'),
    totalTrails: integer('total_trails'),
    openLifts: integer('open_lifts'),
    totalLifts: integer('total_lifts'),
    openBeginnerTrails: integer('open_beginner_trails'),
    totalBeginnerTrails: integer('total_beginner_trails'),
    openAcres: real('open_acres'),
    notes: text('notes'),
    contentHash: text('content_hash'),
    prov: json<Provenance>('prov').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('reports_resort_date').on(t.resortId, t.localDate), index('reports_hash').on(t.resortId, t.contentHash)],
)

/** One retrieval of weather data (forecast or observation) for one point. */
export const weatherRuns = sqliteTable(
  'weather_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    pointKey: text('point_key').notNull(), // 'base' | 'summit'
    provider: text('provider').notNull(), // 'open-meteo' | 'nws' | 'demo'
    model: text('model'),
    kind: text('kind').$type<DataKind>().notNull(), // modeled | observed | demo
    requestedLat: real('requested_lat').notNull(),
    requestedLon: real('requested_lon').notNull(),
    requestedElevationM: real('requested_elevation_m'),
    gridLat: real('grid_lat'),
    gridLon: real('grid_lon'),
    gridElevationM: real('grid_elevation_m'),
    fetchedAt: text('fetched_at').notNull(),
    /** Model run / issue time only when the provider supplies it. Never inferred. */
    modelRunAt: text('model_run_at'),
    timezone: text('timezone').notNull(),
    horizonDays: integer('horizon_days'),
    variables: json<string[]>('variables').notNull(),
    units: json<Record<string, string>>('units').notNull(),
    /**
     * How the provider's accumulations relate to `validTime` (Open-Meteo: 'preceding-hour' — a value stamped T
     * covers (T−1h, T]). Needed to read stored points back without re-attributing hours. Null on error rows.
     */
    intervalSemantics: text('interval_semantics', { enum: ['preceding-hour', 'following-hour', 'instant'] }),
    status: text('status', { enum: ['ok', 'error'] }).notNull(),
    error: text('error'),
    prov: json<Provenance>('prov').notNull(),
  },
  (t) => [index('weather_runs_resort').on(t.resortId, t.pointKey, t.fetchedAt)],
)

/** Hourly values of a weather run (canonical metric; null = variable unavailable). */
export const weatherPoints = sqliteTable(
  'weather_points',
  {
    runId: integer('run_id').notNull().references(() => weatherRuns.id, { onDelete: 'cascade' }),
    validTime: text('valid_time').notNull(), // UTC ISO, start of the hour the values describe (see provider docs)
    localDate: text('local_date').notNull(),
    temperatureC: real('temperature_c'),
    apparentTemperatureC: real('apparent_temperature_c'),
    snowfallCm: real('snowfall_cm'),
    rainMm: real('rain_mm'),
    precipitationMm: real('precipitation_mm'),
    windKmh: real('wind_kmh'),
    gustKmh: real('gust_kmh'),
    humidityPct: real('humidity_pct'),
    visibilityM: real('visibility_m'),
    cloudCoverPct: real('cloud_cover_pct'),
    freezingLevelM: real('freezing_level_m'),
    snowDepthM: real('snow_depth_m'),
    weatherCode: integer('weather_code'),
    isDay: bool('is_day'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.validTime] }), index('weather_points_date').on(t.runId, t.localDate)],
)

/** Official weather warnings (e.g. NWS alerts). Displayed independently of scores. */
export const weatherAlerts = sqliteTable('weather_alerts', {
  id: text('id').primaryKey(), // provider id
  resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  event: text('event').notNull(),
  headline: text('headline'),
  severity: text('severity'),
  onset: text('onset'),
  ends: text('ends'),
  url: text('url'),
  fetchedAt: text('fetched_at').notNull(),
})

export interface ComponentResult {
  key: 'S' | 'T' | 'W' | 'V' | 'C'
  value: number | null
  weight: number
  included: boolean
  inputs: Record<string, number | string | boolean | null>
  note: string
  proxy?: string | null
}

export const conditionsAssessments = sqliteTable(
  'conditions_assessments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    mode: text('mode').$type<ScoringMode>().notNull(),
    modelVersion: text('model_version').notNull(),
    computedAt: text('computed_at').notNull(),
    kind: text('kind').$type<DataKind>().notNull(), // derived | demo
    scoreKind: text('score_kind').$type<ScoreKind>().notNull(),
    score: integer('score'),
    descriptor: text('descriptor'),
    coverage: real('coverage').notNull(),
    components: json<ComponentResult[]>('components').notNull(),
    surface: json<SurfaceInterpretation>('surface').notNull(),
    confidence: text('confidence').$type<Confidence>().notNull(),
    confidenceReasons: json<string[]>('confidence_reasons').notNull(),
    eligibility: text('eligibility').$type<Eligibility>().notNull(),
    leadDays: integer('lead_days'),
    explanation: json<string[]>('explanation').notNull(),
    inputs: json<{ reportId: number | null; weatherRunIds: number[]; statusEventId: number | null }>('inputs').notNull(),
  },
  (t) => [index('assessments_resort_date').on(t.resortId, t.localDate, t.mode)],
)

/** Every fetch attempt of an external source; supports debugging, freshness and change detection. */
export const sourceRecords = sqliteTable(
  'source_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    adapter: text('adapter').notNull(),
    adapterVersion: text('adapter_version'),
    resortId: text('resort_id'),
    url: text('url').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    httpStatus: integer('http_status'),
    ok: bool('ok').notNull(),
    contentHash: text('content_hash'),
    /** Permitted extract (normalised JSON or short text) — never a full copyrighted page. */
    extract: json<unknown>('extract'),
    error: text('error'),
    parserErrors: json<string[] | null>('parser_errors'),
  },
  (t) => [index('source_records_adapter').on(t.adapter, t.resortId, t.fetchedAt)],
)

export const linkChecks = sqliteTable('link_checks', {
  url: text('url').primaryKey(),
  checkedAt: text('checked_at').notNull(),
  httpStatus: integer('http_status'),
  ok: bool('ok'),
  finalUrl: text('final_url'),
  error: text('error'),
  embeddable: bool('embeddable'),
})

// ---------------------------------------------------------------------------
// Passes & prices

export const passFamilies = sqliteTable('pass_families', {
  id: text('id').primaryKey(), // ikon | epic | indy | mountain-collective | regional
  name: text('name').notNull(),
  operator: text('operator'),
  links: json<Record<string, string | null>>('links').notNull(),
  prov: json<Provenance | null>('prov'),
})

export const passProducts = sqliteTable('pass_products', {
  id: text('id').primaryKey(), // e.g. ikon-base-2026-27
  familyId: text('family_id').notNull().references(() => passFamilies.id),
  seasonId: text('season_id').notNull(),
  name: text('name').notNull(),
  /** For resort-specific passes. */
  resortId: text('resort_id'),
  summary: text('summary'),
  blackoutsSummary: text('blackouts_summary'),
  reservationsSummary: text('reservations_summary'),
  salesDeadline: text('sales_deadline'),
  salesDeadlineText: text('sales_deadline_text'),
  renewalNotes: text('renewal_notes'),
  version: integer('version').notNull().default(1),
  prov: json<Provenance | null>('prov'),
  updatedAt: updatedAt(),
})

/** Versioned per-resort access rule for an exact pass product. */
export const passAccessRules = sqliteTable(
  'pass_access_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: text('product_id').notNull().references(() => passProducts.id, { onDelete: 'cascade' }),
    resortId: text('resort_id').notNull(),
    version: integer('version').notNull().default(1),
    access: text('access').$type<PassAccessType>().notNull(),
    days: integer('days'),
    /** Resorts sharing one day allotment carry the same pool id, e.g. "ikon-2026-27:alta-snowbird". */
    poolId: text('pool_id'),
    poolLabel: text('pool_label'),
    blackouts: json<DateRange[]>('blackouts').notNull(),
    /** true/false when known; null = unknown. */
    reservationRequired: bool('reservation_required'),
    reservationNotes: text('reservation_notes'),
    discountText: text('discount_text'),
    eligibilityNotes: text('eligibility_notes'),
    notes: text('notes'),
    prov: json<Provenance | null>('prov'),
    updatedAt: updatedAt(),
  },
  (t) => [index('access_product_resort').on(t.productId, t.resortId)],
)

/**
 * Prices: published price lists, observed quotes, user estimates. Kept as snapshots, never overwritten.
 * `kind` distinguishes observed quotes (official/observed) from user estimates (manual) and demo.
 */
export const priceSnapshots = sqliteTable(
  'price_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subjectType: text('subject_type', {
      enum: ['pass-product', 'lift-ticket', 'rental', 'lesson', 'parking', 'food', 'lodging', 'flight', 'transfer', 'other'],
    }).notNull(),
    subjectId: text('subject_id').notNull(), // product id / resort id / hotel id …
    resortId: text('resort_id'),
    item: text('item').notNull(),
    category: text('category'), // adult | teen | child | college | …
    amountMinor: integer('amount_minor').notNull(),
    /** Optional upper bound for editable estimate ranges. */
    amountMaxMinor: integer('amount_max_minor'),
    currency: text('currency').notNull(),
    seasonId: text('season_id'),
    dayType: text('day_type'), // weekday | weekend | holiday | peak | any
    appliesFrom: text('applies_from'),
    appliesTo: text('applies_to'),
    purchaseBy: text('purchase_by'),
    includesTax: bool('includes_tax'),
    feesText: text('fees_text'),
    quoteKind: text('quote_kind', { enum: ['published', 'observed-quote', 'user-estimate', 'demo'] }).notNull(),
    observedAt: text('observed_at').notNull(),
    expiresAt: text('expires_at'),
    prov: json<Provenance>('prov').notNull(),
  },
  (t) => [index('prices_subject').on(t.subjectType, t.subjectId)],
)

export const fxRates = sqliteTable(
  'fx_rates',
  {
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    /** Decimal string — never a float. */
    rate: text('rate').notNull(),
    rateDate: text('rate_date').notNull(),
    provider: text('provider').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    kind: text('kind').$type<DataKind>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.rateDate] })],
)

// ---------------------------------------------------------------------------
// Travel, lodging, events

export interface DriveEstimate {
  minutes: number | null
  km: number | null
  basis: string | null
  prov: Provenance | null
}

export const airports = sqliteTable('airports', {
  iata: text('iata').primaryKey(),
  name: text('name').notNull(),
  city: text('city'),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  timezone: text('timezone'),
  role: text('role', { enum: ['origin', 'destination', 'both'] }).notNull(),
  officialUrl: text('official_url'),
  airlinesUrl: text('airlines_url'),
  airlines: json<{ airline: string; nonstops: string[]; seasonal: string | null; sourceUrl: string | null }[]>('airlines').notNull(),
  parking: text('parking'),
  driveFromHome: json<DriveEstimate | null>('drive_from_home'),
  notes: text('notes'),
  prov: json<Provenance | null>('prov'),
})

export const travelOptions = sqliteTable(
  'travel_options',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['drive-from-home', 'airport', 'transfer'] }).notNull(),
    airportIata: text('airport_iata'),
    role: text('role'), // closest | practical | both
    name: text('name'),
    transferType: text('transfer_type'), // bus | shuttle | rental-car | private | train
    minutes: integer('minutes'),
    km: real('km'),
    basis: text('basis'),
    url: text('url'),
    notes: text('notes'),
    prov: json<Provenance | null>('prov'),
  },
  (t) => [index('travel_resort').on(t.resortId)],
)

export const hotels = sqliteTable('hotels', {
  id: text('id').primaryKey(),
  resortId: text('resort_id').notNull().references(() => resorts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tier: text('tier', { enum: ['budget', 'comfortable', 'premium'] }),
  brand: text('brand'),
  address: text('address'),
  lat: real('lat'),
  lon: real('lon'),
  officialUrl: text('official_url'),
  distanceText: text('distance_text'),
  skiInOut: text('ski_in_out', { enum: ['verified-yes', 'verified-no', 'unknown'] }).notNull().default('unknown'),
  shuttle: text('shuttle'),
  parking: text('parking'),
  notes: text('notes'),
  origin: text('origin', { enum: ['catalog', 'user'] }).notNull().default('catalog'),
  prov: json<Provenance | null>('prov'),
})

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    resortId: text('resort_id'),
    title: text('title').notNull(),
    category: text('category').notNull(),
    venue: text('venue'),
    /** Venue-local wall time, 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'; null when not announced. */
    startLocal: text('start_local'),
    endLocal: text('end_local'),
    timezone: text('timezone').notNull(),
    status: text('status', { enum: ['announced', 'tentative', 'not-announced', 'postponed', 'cancelled'] }).notNull(),
    lastEdition: text('last_edition'),
    ticketUrl: text('ticket_url'),
    priceMinor: integer('price_minor'),
    currency: text('currency'),
    ageRestriction: text('age_restriction'),
    bookingRequired: bool('booking_required'),
    officialUrl: text('official_url'),
    dedupeKey: text('dedupe_key').notNull(),
    origin: text('origin', { enum: ['catalog', 'user', 'feed'] }).notNull().default('catalog'),
    lastVerifiedAt: text('last_verified_at'),
    prov: json<Provenance | null>('prov'),
  },
  (t) => [uniqueIndex('events_dedupe').on(t.dedupeKey), index('events_resort').on(t.resortId)],
)

// ---------------------------------------------------------------------------
// Personal records

export interface TravelPrefs {
  maxDriveHours: number | null
  willingToFly: boolean
  originAirports: string[] // e.g. ['ITH','SYR','ELM','ROC','BUF']
  winterBufferPct: number // explicit planning assumption for winter driving
}

export interface GearPrefs {
  ownsSkis: boolean
  ownsBoots: boolean
  ownsHelmet: boolean
  rentalOption: 'full-package' | 'skis-only' | 'boots-only' | 'none'
}

export interface BudgetPrefs {
  dayBudgetMinor: number | null
  seasonBudgetMinor: number | null
  currency: string
  lunchEstimateMinor: number // basket assumption (editable)
}

export interface RecommendationWeights {
  conditions: number
  fit: number
  travel: number
  cost: number
  events: number
}

export const userPreferences = sqliteTable('user_preferences', {
  id: integer('id').primaryKey(), // always 1
  homeName: text('home_name').notNull(),
  homeLat: real('home_lat').notNull(),
  homeLon: real('home_lon').notNull(),
  homeTimezone: text('home_timezone').notNull(),
  activeSeasonId: text('active_season_id').notNull(),
  ability: text('ability').$type<AbilityLevel>().notNull(),
  companionAbility: text('companion_ability').$type<AbilityLevel | null>(),
  companionName: text('companion_name'),
  units: json<UnitPrefs>('units').notNull(),
  currency: text('currency').notNull(),
  scoringMode: text('scoring_mode').$type<ScoringMode>().notNull(),
  travel: json<TravelPrefs>('travel').notNull(),
  gear: json<GearPrefs>('gear').notNull(),
  budget: json<BudgetPrefs>('budget').notNull(),
  lodgingStyle: text('lodging_style'),
  weights: json<RecommendationWeights>('weights').notNull(),
  theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
  onboardingDone: bool('onboarding_done').notNull().default(false),
  updatedAt: updatedAt(),
})

export const favorites = sqliteTable('favorites', {
  resortId: text('resort_id').primaryKey().references(() => resorts.id, { onDelete: 'cascade' }),
  addedAt: text('added_at').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const myRatings = sqliteTable('my_ratings', {
  resortId: text('resort_id').primaryKey().references(() => resorts.id, { onDelete: 'cascade' }),
  rating: integer('rating'), // 1–5, personal
  review: text('review'),
  updatedAt: updatedAt(),
})

export const passOwnership = sqliteTable('pass_ownership', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: text('product_id').notNull().references(() => passProducts.id),
  holder: text('holder').notNull().default('me'),
  purchasedOn: text('purchased_on'),
  pricePaidMinor: integer('price_paid_minor'),
  currency: text('currency'),
  notes: text('notes'),
  createdAt: createdAt(),
})

export const passUsage = sqliteTable('pass_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownershipId: integer('ownership_id').notNull().references(() => passOwnership.id, { onDelete: 'cascade' }),
  resortId: text('resort_id').notNull(),
  date: text('date').notNull(),
  notes: text('notes'),
  createdAt: createdAt(),
})

export const trips = sqliteTable('trips', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'booked', 'done', 'cancelled'] }).notNull().default('draft'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  partySize: integer('party_size').notNull().default(1),
  originAirport: text('origin_airport'),
  companions: json<{ name: string; ability: AbilityLevel | null }[]>('companions').notNull(),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const TRIP_ITEM_TYPES = [
  'resort-day',
  'drive',
  'flight',
  'transfer',
  'lodging',
  'lesson',
  'rental',
  'lift-ticket',
  'parking',
  'food',
  'event',
  'other',
] as const
export type TripItemType = (typeof TRIP_ITEM_TYPES)[number]

export const tripItems = sqliteTable(
  'trip_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: text('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
    type: text('type').$type<TripItemType>().notNull(),
    refId: text('ref_id'), // resort / hotel / event / airport id
    title: text('title').notNull(),
    date: text('date'),
    endDate: text('end_date'),
    status: text('status', { enum: ['idea', 'draft', 'booked'] }).notNull().default('draft'),
    costMinor: integer('cost_minor'),
    costMaxMinor: integer('cost_max_minor'),
    currency: text('currency'),
    costKind: text('cost_kind', { enum: ['quote', 'estimate', 'actual'] }),
    /** 'per-person' amounts are multiplied by party size; 'shared' amounts are split. */
    costBasis: text('cost_basis', { enum: ['per-person', 'shared'] }).notNull().default('per-person'),
    fxRate: text('fx_rate'),
    fxDate: text('fx_date'),
    quoteExpiresAt: text('quote_expires_at'),
    details: json<Record<string, unknown>>('details').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('trip_items_trip').on(t.tripId)],
)

export const tripChecklist = sqliteTable('trip_checklist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tripId: text('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  category: text('category'),
  done: bool('done').notNull().default(false),
  link: text('link'),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const checklistTemplates = sqliteTable('checklist_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  category: text('category'),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const skiDayLogs = sqliteTable('ski_day_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  resortId: text('resort_id').notNull(),
  tripId: text('trip_id'),
  rating: integer('rating'),
  surfaceFeedback: json<SurfaceTag[]>('surface_feedback').notNull(),
  preferredTime: text('preferred_time'),
  crowdGuess: text('crowd_guess'),
  skillsPracticed: json<number[]>('skills_practiced').notNull(),
  hoursSkied: real('hours_skied'),
  spendMinor: integer('spend_minor'),
  currency: text('currency'),
  notes: text('notes'),
  createdAt: createdAt(),
})

export const skillChecklist = sqliteTable('skill_checklist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  category: text('category'),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status', { enum: ['not-started', 'practicing', 'self-confirmed', 'instructor-confirmed'] })
    .notNull()
    .default('not-started'),
  confirmedOn: text('confirmed_on'),
  notes: text('notes'),
})

export const lessons = sqliteTable('lessons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resortId: text('resort_id').notNull(),
  tripId: text('trip_id'),
  date: text('date'),
  kind: text('kind'), // group | private | semi-private | clinic
  instructor: text('instructor'),
  focusSkills: json<number[]>('focus_skills').notNull(),
  bookingRef: text('booking_ref'),
  bookingUrl: text('booking_url'),
  costMinor: integer('cost_minor'),
  currency: text('currency'),
  costKind: text('cost_kind', { enum: ['quote', 'estimate', 'actual'] }),
  notes: text('notes'),
  createdAt: createdAt(),
})

/** Personal expenses outside trips (e.g. gear, pass purchase) for the season budget. */
export const expenses = sqliteTable('expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  category: text('category').notNull(), // pass | lift | lodging | travel | food | lessons | rentals | gear | other
  label: text('label').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  tripId: text('trip_id'),
  /** Links the expense to a pass purchase so it is never double counted as a daily cost. */
  passOwnershipId: integer('pass_ownership_id'),
  notes: text('notes'),
  createdAt: createdAt(),
})

export const ALERT_TYPES = [
  'opening-date-change',
  'resort-opened',
  'pass-deadline',
  'snow-threshold',
  'forecast-deterioration',
  'event',
  'price-change',
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export const alertRules = sqliteTable('alert_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').$type<AlertType>().notNull(),
  resortId: text('resort_id'),
  params: json<Record<string, unknown>>('params').notNull(),
  enabled: bool('enabled').notNull().default(true),
  cooldownHours: integer('cooldown_hours').notNull().default(12),
  lastFiredAt: text('last_fired_at'),
  createdAt: createdAt(),
})

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ruleId: integer('rule_id'),
  type: text('type').$type<AlertType>().notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  resortId: text('resort_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  firedAt: text('fired_at').notNull(),
  readAt: text('read_at'),
})

export interface RefreshItemOutcome {
  /** Stable item key, e.g. "alta:summit:open-meteo". */
  key: string
  /** Resort id (or other subject) the item belongs to; used for per-target "last success". */
  target: string | null
  ok: boolean
  /** Nothing to do (unsupported, unchanged, not due) — neither success nor failure. */
  skipped?: boolean
  written: number
  error?: string | null
}

export interface RefreshRunDetails {
  items: RefreshItemOutcome[]
  notes?: string[]
}

/** Scheduler / manual refresh bookkeeping. */
export const refreshRuns = sqliteTable(
  'refresh_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    job: text('job').notNull(), // weather | reports | nws-alerts | links | fx | assessments | prune | alerts
    target: text('target'), // resort id or null for global jobs
    trigger: text('trigger', { enum: ['schedule', 'manual', 'startup'] }).notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: ['running', 'ok', 'partial', 'error', 'skipped'] }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    itemsWritten: integer('items_written').notNull().default(0),
    error: text('error'),
    /** Per-source outcomes (one resort failing never aborts the others; this records which ones failed). */
    details: json<RefreshRunDetails | null>('details'),
  },
  (t) => [index('refresh_job_target').on(t.job, t.target, t.startedAt)],
)

/** Key/value app metadata (schema version, tracking start dates, scheduler heartbeat). */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
})
