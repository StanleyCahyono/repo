/**
 * Types for Piste Conditions v1: engine inputs, the editable configuration shape and the assessment output.
 *
 * Pure types only. Inputs are structural so DB rows (OperationalReportRow, WeatherPointRow) and provider
 * values (HourlyWeather, OfficialAlert) can be passed without adapters where the field names already agree.
 */
import type {
  AppMode,
  ComponentKey,
  Confidence,
  DataKind,
  Eligibility,
  OperatingStatus,
  ScoreKind,
  ScoringMode,
  SnowfallReading,
  SurfaceInterpretation,
  SurfaceTag,
  UnitPrefs,
} from '../types'
import type { HourlyWeather, OfficialAlert, WeatherSeries } from '@/lib/providers/types'

// ---------------------------------------------------------------------------
// Curves

/** A point on a piecewise-linear curve: `[input, score]`. */
export type CurvePoint = readonly [x: number, y: number]
/** Piecewise-linear curve, x strictly ascending; values outside the range clamp to the end points. */
export type Curve = readonly CurvePoint[]

// ---------------------------------------------------------------------------
// Weather input

export type IntervalSemantics = WeatherSeries['intervalSemantics']

/** Hourly series for one weather point (base or summit) as the engine consumes it. */
export interface PointWeather {
  /** 'base' | 'summit' | other catalog key. */
  pointKey: string
  kind: Extract<DataKind, 'modeled' | 'observed' | 'demo'>
  provider: string | null
  model: string | null
  /** How accumulations relate to each hour's `validTime` (Open-Meteo: 'preceding-hour'). */
  intervalSemantics: IntervalSemantics
  /** When Piste retrieved the run (not the model run time). */
  fetchedAt: string | null
  /** Model run / issue time only if the provider supplied it. */
  modelRunAt: string | null
  elevationM: number | null
  /** Number of forecast days the run covers counting today (Open-Meteo forecast_days). */
  horizonDays: number | null
  hourly: readonly HourlyWeather[]
}

// ---------------------------------------------------------------------------
// Evidence input

/**
 * Most recent operations/snow report relevant to the assessed date. Structurally compatible with
 * `OperationalReportRow` (official / manual / demo kinds live in the same table).
 */
export interface ReportEvidence {
  kind: DataKind
  /** Resort-local date the report describes. */
  localDate: string
  /** Time the source says it published the report. Never the fetch time. */
  reportedAt: string | null
  status: OperatingStatus | null
  snowfall: readonly SnowfallReading[]
  baseDepthCm: number | null
  surfaceTags: readonly SurfaceTag[]
  /** Source wording, verbatim. */
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
}

/** My own surface feedback after a ski day (from the season journal). */
export interface PersonalFeedback {
  /** Resort-local ski date the feedback describes. */
  date: string
  surfaceTags: readonly SurfaceTag[]
  /** When the feedback was written (UTC instant), if known. */
  recordedAt: string | null
  note?: string | null
}

/** Operating status and season dates for the resort (season-specific). */
export interface OperationsEvidence {
  /** Latest status statement from status events (the report's own status is merged in by the engine). */
  status: OperatingStatus | null
  /** Resort-local date the status statement applies to. */
  statusDate: string | null
  /** When the status was stated (effectiveAt / reportedAt). */
  statusAt: string | null
  announcedOpening: string | null
  /** Piste-derived estimate (labelled Estimated, never Announced). */
  estimatedOpenFrom: string | null
  actualOpening: string | null
  announcedClosing: string | null
  actualClosing: string | null
}

export interface AssessDayInput {
  /** Resort-local date being assessed, YYYY-MM-DD. */
  date: string
  /** Resort IANA timezone. */
  timezone: string
  /** App clock instant (ctx.now). Never read the system clock inside the engine. */
  now: string
  mode: ScoringMode
  weather: { base?: PointWeather | null; summit?: PointWeather | null }
  report: ReportEvidence | null
  personalFeedback?: readonly PersonalFeedback[]
  operations: OperationsEvidence
  /** Official alerts (e.g. NWS). Passed through as warnings; never change the score. */
  alerts?: readonly OfficialAlert[]
  /** Published lift hours for the date, resort-local 'HH:mm'. Defaults to the config window. */
  operatingHours?: { opens: string; closes: string } | null
  /** Daily snowfall for the assessed date from an alternate model, when genuinely available. */
  alternateModel?: { label: string; snowfallCm: number | null } | null
  /** Display units for explanation strings (numbers in `components[].inputs` stay metric). */
  units?: UnitPrefs
  appMode?: AppMode
  /** Row references carried into the `inputs` column. */
  refs?: AssessmentInputRefs
}

export interface AssessmentInputRefs {
  reportId: number | null
  weatherRunIds: number[]
  statusEventId: number | null
}

// ---------------------------------------------------------------------------
// Output

/** Same shape as `ComponentResult` in the DB schema (checked in score.test.ts). */
export interface ConditionsComponent {
  key: ComponentKey
  value: number | null
  /** Effective weight used in the score (nominal weight × any evidence factor). */
  weight: number
  included: boolean
  inputs: Record<string, number | string | boolean | null>
  note: string
  proxy?: string | null
}

export type ScoreDescriptor = 'Excellent' | 'Good' | 'Mixed' | 'Challenging'

export interface GateResult {
  passed: boolean
  /** Why the operational gate failed (empty when passed or not applied). */
  reasons: string[]
  /** Components not contributing to the score. */
  excluded: ComponentKey[]
  applied: boolean
}

/** Maps 1:1 onto `conditions_assessments` columns, plus `warnings`, `hardRuleNotes` and `gate`. */
export interface DayAssessment {
  localDate: string
  mode: ScoringMode
  modelVersion: string
  computedAt: string
  kind: Extract<DataKind, 'derived' | 'demo'>
  scoreKind: ScoreKind
  score: number | null
  descriptor: string | null
  coverage: number
  components: ConditionsComponent[]
  surface: SurfaceInterpretation
  confidence: Confidence
  confidenceReasons: string[]
  eligibility: Eligibility
  leadDays: number | null
  explanation: string[]
  inputs: AssessmentInputRefs
  /** Official alerts overlapping the date, independent of the score. */
  warnings: OfficialAlert[]
  /** Hard rules that shaped this assessment (closure override, unknown status, beginner fresh-snow rule…). */
  hardRuleNotes: string[]
  gate: GateResult
}

// ---------------------------------------------------------------------------
// Configuration shape (values live in config.v1.ts)

export type SurfaceBasis = SurfaceInterpretation['basis']
export type ScoredSurfaceTag = Exclude<SurfaceTag, 'unknown'>

export interface ConditionsConfig {
  version: string
  /** Per-mode component weights in percent; each mode sums to 100. */
  weights: Record<ScoringMode, Record<ComponentKey, number>>
  /** Descending by `min`. */
  descriptors: readonly { min: number; label: ScoreDescriptor }[]
  gate: {
    /** Surface bases accepted as "surface evidence" for a full conditions score. */
    surfaceEvidenceBases: readonly SurfaceBasis[]
    requireTerrain: boolean
    requireWind: boolean
    minCoverage: number
  }
  limited: {
    /** Below this weighted coverage a limited-data day shows no overall estimate, only components. */
    minCoverageForEstimate: number
  }
  weightFactors: {
    /** Multiplier on S's weight when the surface is inferred (model-only or stale report). */
    inferredSurface: number
    /** Multiplier on a component's weight when it is computed from a labelled proxy. */
    proxy: number
  }
  /** Default lift-operating window (resort-local) when no published hours are supplied. */
  operatingWindow: { opens: string; closes: string }
  horizon: { defaultDays: number }
  /** Preferred weather point order per purpose; the first point with values for the purpose's variables wins. */
  points: {
    surface: Record<ScoringMode, readonly string[]>
    wind: readonly string[]
    comfort: Record<ScoringMode, readonly string[]>
    visibility: readonly string[]
  }
  surface: SurfaceRulesConfig
  components: ComponentCurvesConfig
  confidence: ConfidenceConfig
}

export interface SurfaceRulesConfig {
  /** Report kinds treated as official-quality surface evidence. */
  reportKinds: readonly DataKind[]
  /** A report for the assessed date at most this old (h) is "fresh" and can be shown as reported. */
  reportFreshMaxAgeHours: number
  /** Older than fresh but at most this old: downgraded to an inference that references it. Older: ignored. */
  reportStaleMaxAgeHours: number
  personalMaxAgeHours: number
  /** A report/feedback this recent showing base depth, open terrain or a surface proves snow exists. */
  snowKnownMaxAgeDays: number
  /** Below this hourly amount snowfall is treated as a trace (cm). */
  traceSnowCm: number
  /** Hourly rain at or above this counts as wetting (mm). */
  traceRainMm: number
  /** Weather after a fresh report that supersedes it. */
  reportSuperseded: { id: string; snowCm: number; rainMm: number }
  freshSnow: {
    id: string
    lookbackHours: number
    minSnowCm: number
    deepSnowCm: number
    maxRainAfterMm: number
    warmAfterC: number
    maxWarmHoursAfter: number
  }
  thawRefreeze: {
    id: string
    lookbackHours: number
    thawTempC: number
    minThawHours: number
    minRainMm: number
    freezeTempC: number
    minFreezeHours: number
    icyRainMm: number
    icyThawHours: number
  }
  warmWet: { id: string; minRainMm: number; warmTempC: number; minWarmHours: number }
  lateDayWarming: { id: string; morningHours: number; morningMaxC: number; afternoonMinC: number }
  windAffected: { id: string; lookbackHours: number; sustainedKmh: number; gustKmh: number; recentSnowCm: number }
  staleReport: { id: string }
  freshReport: { id: string }
  personal: { id: string }
}

export interface ComponentCurvesConfig {
  S: {
    /** Base suitability per mode and surface tag. */
    base: Record<ScoringMode, Record<ScoredSurfaceTag, number>>
    /** Added when the surface includes fresh snow, by fresh amount (cm). Learning goes negative with depth. */
    freshSnowAdjustment: Record<ScoringMode, Curve>
    /** Fraction of a negative learning fresh-snow adjustment removed when grooming is reported. */
    learningGroomedMitigation: number
    /** Added when a tag is secondary to another surface (e.g. wind-affected on fresh snow). */
    secondaryAdjustment: Partial<Record<ScoredSurfaceTag, number>>
    /** Upper bound for S when the surface is only inferred. */
    inferredCap: number
  }
  T: {
    /** Open fraction (0–1) → score. */
    ratioCurve: Curve
    /** Open beginner trail count → score, when the beginner total is unknown. */
    beginnerCountCurve: Curve
    reportMaxAgeHours: number
  }
  W: {
    /** Gusts are weighted by this factor before taking max(sustained, weighted gust). */
    gustWeight: number
    /** Effective wind (km/h) → score. */
    curve: Curve
  }
  V: {
    /** Visibility (m) → score. */
    curve: Curve
    proxy: {
      /** Cloud cover (%) → score, used only when visibility is missing. */
      cloudCurve: Curve
      /** Hourly precipitation (mm) at or above which an hour is penalised. */
      precipMmPerHour: number
      precipPenalty: number
    }
  }
  C: {
    /** Apparent temperature (°C) → score. */
    curve: Curve
    windChill: { maxTempC: number; minWindKmh: number }
  }
}

export interface ConfidenceConfig {
  weatherStaleHours: number
  /** Lead days at/above which confidence is reduced by 1 and 2 steps. */
  leadDays: { medium: number; low: number }
  coverage: { high: number; medium: number }
  disagreement: { minAbsCm: number; minRelative: number }
  /** Low when any factor reaches this penalty or the total reaches `lowTotal`; medium when total ≥ 1. */
  lowFactorPenalty: number
  lowTotal: number
}
