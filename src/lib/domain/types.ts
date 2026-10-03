/**
 * Core domain vocabulary shared by the database layer, providers, engines and UI.
 *
 * Conventions
 * - Unknown is `null`, never 0, '' or a guessed default.
 * - Stored measurements are canonical metric: cm (snow depth / snowfall), mm (liquid precipitation),
 *   °C, km/h, metres (elevation, visibility, freezing level), km (distance). Display units are applied at render time.
 * - Money is integer minor units + ISO 4217 currency (see money.ts). Never floats.
 * - Instants are ISO-8601 UTC strings (`2027-01-15T14:00:00.000Z`). Resort-local calendar days are
 *   `YYYY-MM-DD` strings computed in the resort's IANA timezone (see time.ts).
 */

/** Where a fact came from. Drives badges, freshness rules and what may feed recommendations. */
export const DATA_KINDS = [
  'official', // published by the resort/operator/pass company/organizer (report, announcement, price list)
  'observed', // an instrument observation (e.g. NWS station)
  'modeled', // numerical weather model output
  'derived', // computed by Piste (scores, surface interpretation, aggregates)
  'manual', // entered by the user or curated by hand with a source link
  'historical', // past-season reference information
  'demo', // demonstration data — never mixed with live records
] as const
export type DataKind = (typeof DATA_KINDS)[number]

/**
 * How a curated/manual fact was verified. Researched ('search-summary'), official, API and user-confirmed facts are
 * shown normally; 'unverified' facts (no source backs them) are not shown at all (see src/lib/data/shown.ts).
 */
export const VERIFICATION_LEVELS = ['api', 'official-page', 'search-summary', 'user-confirmed', 'unverified'] as const
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number]

export interface Provenance {
  kind: DataKind
  /** Human-readable provider, e.g. "Open-Meteo", "NWS", "greekpeak.net", "Piste research (web search)". */
  provider: string | null
  sourceUrl: string | null
  /** Season the fact applies to, e.g. "2026-27". */
  season?: string | null
  /** When the source says the fact was published/observed (NOT when we fetched it). */
  publishedAt?: string | null
  /** When Piste retrieved it successfully. */
  fetchedAt?: string | null
  /** Interval the fact is valid for (e.g. forecast valid time, price window). */
  validFrom?: string | null
  validTo?: string | null
  /** After this instant the fact is displayed as stale. */
  staleAfter?: string | null
  verification?: VerificationLevel | null
  /** Unit or currency as originally supplied, when converted. */
  originalUnit?: string | null
  note?: string | null
}

export function provenance(p: Partial<Provenance> & Pick<Provenance, 'kind'>): Provenance {
  return {
    provider: null,
    sourceUrl: null,
    season: null,
    publishedAt: null,
    fetchedAt: null,
    validFrom: null,
    validTo: null,
    staleAfter: null,
    verification: null,
    originalUnit: null,
    note: null,
    ...p,
  }
}

// ---------------------------------------------------------------------------
// Operations

export const OPERATING_STATUSES = [
  'not-yet-open',
  'open',
  'partially-open',
  'temporarily-closed',
  'closed-for-season',
  'unknown',
] as const
export type OperatingStatus = (typeof OPERATING_STATUSES)[number]

export const OPERATING_STATUS_LABEL: Record<OperatingStatus, string> = {
  'not-yet-open': 'Not yet open',
  open: 'Open',
  'partially-open': 'Partially open',
  'temporarily-closed': 'Temporarily closed',
  'closed-for-season': 'Closed for season',
  unknown: 'Status unavailable',
}

/** Opening-date labels. An announced date is a target, not a confirmed open day. */
export const OPENING_LABELS = ['announced', 'estimated', 'opened', 'not-announced'] as const
export type OpeningLabel = (typeof OPENING_LABELS)[number]

export const SCHEDULE_ACTIVITIES = ['lifts', 'night-skiing', 'ticket-office', 'rentals', 'lessons', 'tubing', 'other'] as const
export type ScheduleActivity = (typeof SCHEDULE_ACTIVITIES)[number]

// ---------------------------------------------------------------------------
// Snow and surface

export const SNOW_WINDOWS = ['overnight', '24h', '48h', '72h', '7d', 'storm', 'season'] as const
export type SnowWindow = (typeof SNOW_WINDOWS)[number]

export interface SnowfallReading {
  window: SnowWindow
  amountCm: number | null
  /** Accumulation interval if the source states it (ISO instants). */
  startAt?: string | null
  endAt?: string | null
  /** Source wording, e.g. `4" overnight`. */
  sourceText?: string | null
}

export const SURFACE_TAGS = [
  'fresh-snow',
  'packed-powder',
  'firm',
  'icy-refrozen',
  'wet-slushy',
  'spring-snow',
  'wind-affected',
  'mixed',
  'unknown',
] as const
export type SurfaceTag = (typeof SURFACE_TAGS)[number]

export const SURFACE_LABEL: Record<SurfaceTag, string> = {
  'fresh-snow': 'Fresh snow',
  'packed-powder': 'Packed powder',
  firm: 'Firm / hardpack',
  'icy-refrozen': 'Icy or refrozen',
  'wet-slushy': 'Wet / slushy',
  'spring-snow': 'Spring snow',
  'wind-affected': 'Wind-affected',
  mixed: 'Mixed',
  unknown: 'Unknown',
}

/** Surface description with its epistemic status. Model inference must read "Likely …". */
export interface SurfaceInterpretation {
  tags: SurfaceTag[]
  basis: 'reported' | 'personal' | 'inferred' | 'none'
  /** Plain-language text. For `inferred`, always phrased as "Likely …". */
  text: string
  /** Rule ids from the conditions config that fired. */
  rules: string[]
}

// ---------------------------------------------------------------------------
// Conditions model

export const SCORING_MODES = ['learning', 'all-mountain', 'powder'] as const
export type ScoringMode = (typeof SCORING_MODES)[number]

export const SCORING_MODE_LABEL: Record<ScoringMode, string> = {
  learning: 'Learning day',
  'all-mountain': 'All-mountain day',
  powder: 'Powder preference',
}

export const COMPONENT_KEYS = ['S', 'T', 'W', 'V', 'C'] as const
export type ComponentKey = (typeof COMPONENT_KEYS)[number]

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  S: 'Surface suitability',
  T: 'Terrain availability',
  W: 'Wind comfort',
  V: 'Visibility',
  C: 'Temperature comfort',
}

export type Confidence = 'high' | 'medium' | 'low'

export type ScoreKind =
  | 'conditions' // complete operational conditions score (gate passed)
  | 'weather-potential' // future day, weather-derived components only
  | 'limited' // gate failed; component estimates only
  | 'closed' // confirmed closure — no ski-day score
  | 'none'

export type Eligibility = 'eligible' | 'closed' | 'status-unknown' | 'preseason' | 'out-of-horizon'

// ---------------------------------------------------------------------------
// Passes

export const PASS_FAMILIES = ['ikon', 'epic', 'indy', 'mountain-collective', 'regional'] as const
export type PassFamilyId = (typeof PASS_FAMILIES)[number]

export const PASS_ACCESS = [
  'unlimited',
  'limited-days',
  'shared-pool',
  'discount-only',
  'not-included',
  'unknown',
] as const
export type PassAccessType = (typeof PASS_ACCESS)[number]

export interface DateRange {
  /** Inclusive local dates YYYY-MM-DD. */
  from: string
  to: string
  label?: string | null
}

// ---------------------------------------------------------------------------
// Units

export type TempUnit = 'F' | 'C'
export type SnowUnit = 'in' | 'cm'
export type DistanceUnit = 'mi' | 'km'
export type ElevationUnit = 'ft' | 'm'
export type SpeedUnit = 'mph' | 'kmh'

export interface UnitPrefs {
  temperature: TempUnit
  snow: SnowUnit
  distance: DistanceUnit
  elevation: ElevationUnit
  speed: SpeedUnit
}

export const DEFAULT_UNITS: UnitPrefs = {
  temperature: 'F',
  snow: 'in',
  distance: 'mi',
  elevation: 'ft',
  speed: 'mph',
}

// ---------------------------------------------------------------------------
// People

export const ABILITY_LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'expert'] as const
export type AbilityLevel = (typeof ABILITY_LEVELS)[number]

export const EXPENSE_TIERS = ['$', '$$', '$$$', '$$$$'] as const
export type ExpenseTier = (typeof EXPENSE_TIERS)[number]

export type AppMode = 'live' | 'demo'
