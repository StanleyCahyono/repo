/**
 * View-model shapes and pure builders shared by the read models (status, opening, snow, travel, cost, passes,
 * fit, events, alerts). Every fact shown carries its provenance. Internal to src/lib/data.
 */
import 'server-only'
import type {
  ConditionsAssessmentRow,
  EventRow,
  OperationalReportRow,
  ResortRow,
  ResortSeasonRow,
  StatusEventRow,
  WeatherAlertRow,
  WeatherRunRow,
} from '@/lib/db/rows'
import type { FeatureInfo } from '@/lib/db/schema'
import type { DailyWeatherAggregate } from '@/lib/domain/conditions'
import { computeDayBasket, type BasketLine, type DayBasket } from '@/lib/domain/costs'
import { computeFit, travelVerdict, type FitResult, type TravelVerdict } from '@/lib/domain/fit'
import { money, type Money } from '@/lib/domain/money'
import { evaluateAccess, familyBadges, latestRule, type AccessVerdict } from '@/lib/domain/passes'
import { confirmedClosure, type CandidateOps, type ClosureKind } from '@/lib/domain/recommend'
import { daysUntil, openingLabel } from '@/lib/domain/season'
import { addDays, hoursBetween, seasonIdFor, startOfLocalDay } from '@/lib/domain/time'
import {
  OPERATING_STATUS_LABEL,
  provenance,
  type AbilityLevel,
  type Confidence,
  type DataKind,
  type Eligibility,
  type ExpenseTier,
  type OpeningLabel,
  type OperatingStatus,
  type PassAccessType,
  type Provenance,
  type ScoreKind,
  type ScoringMode,
  type SnowfallReading,
  type SurfaceInterpretation,
  type SurfaceTag,
} from '@/lib/domain/types'
import type { ComponentResult } from '@/lib/db/schema'
import { derivedProv, needsConfirmation, resortToday, seasonLabel, type Bundle, type OwnedPass, type SnowSum } from './core'
import { reportOrigin, type ReportOrigin } from './deps'

// ---------------------------------------------------------------------------
// Operating status

export interface StatusView {
  status: OperatingStatus
  label: string
  /** When the current status was first stated (status events are appended only on change). */
  since: string | null
  /** Resort-local date the latest statement applies to. */
  localDate: string | null
  /** reported = an official/manual statement; season = derived by Piste from season dates; none = nothing recorded. */
  basis: 'reported' | 'season' | 'none'
  prov: Provenance | null
  note: string | null
  /** Latest report (publish time) repeating the same status. */
  lastConfirmedAt: string | null
  /** Hours since the latest statement or confirmation. */
  ageHours: number | null
  /**
   * Season the statement belongs to. A 'closed-for-season' kept from an earlier season (the only statement that
   * carries over) means "closed since last season", not that the current season has ended — see `note`.
   */
  seasonId: string | null
}

export function statusView(resort: Pick<ResortRow, 'timezone'>, event: StatusEventRow | undefined, report: OperationalReportRow | undefined, now: string): StatusView {
  if (!event) {
    return {
      status: 'unknown',
      label: OPERATING_STATUS_LABEL.unknown,
      since: null,
      localDate: null,
      basis: 'none',
      prov: null,
      note: 'No operating status recorded',
      lastConfirmedAt: null,
      ageHours: null,
      seasonId: null,
    }
  }
  const today = resortToday(resort, now)
  const currentSeason = seasonIdFor(today)
  const eventSeason = seasonIdFor(event.localDate)
  // A statement from an earlier season says nothing about this one — except that a season-end closure still holds.
  if (eventSeason !== currentSeason && event.status !== 'closed-for-season') {
    return {
      status: 'unknown',
      label: OPERATING_STATUS_LABEL.unknown,
      since: null,
      localDate: null,
      basis: 'none',
      prov: event.prov,
      note: `Latest status (${OPERATING_STATUS_LABEL[event.status]}) is from the ${seasonLabel(eventSeason)} season`,
      lastConfirmedAt: null,
      ageHours: null,
      seasonId: eventSeason,
    }
  }
  const confirmed =
    report && report.status === event.status && report.localDate >= event.localDate && report.reportedAt && report.reportedAt >= event.effectiveAt
      ? report.reportedAt
      : null
  const latestAt = confirmed ?? event.effectiveAt
  return {
    status: event.status,
    label: OPERATING_STATUS_LABEL[event.status],
    since: event.effectiveAt,
    localDate: event.localDate,
    basis: event.prov?.kind === 'derived' ? 'season' : 'reported',
    prov: event.prov,
    note:
      eventSeason !== currentSeason
        ? `Closed since the end of the ${seasonLabel(eventSeason)} season — no ${seasonLabel(currentSeason)} status reported yet`
        : event.note,
    lastConfirmedAt: confirmed,
    ageHours: Math.max(0, Math.round(hoursBetween(latestAt, now) * 10) / 10),
    seasonId: eventSeason,
  }
}

export interface StatusStatement {
  status: OperatingStatus | null
  statusDate: string | null
  statusAt: string | null
  /** Which record the statement came from. */
  source: 'event' | 'report' | null
  prov: Provenance | null
}

/** Latest status statement for recommendation eligibility: the newer of the status event and the report's status. */
export function statusStatement(event: StatusEventRow | undefined, report: OperationalReportRow | undefined): StatusStatement {
  const fromEvent: StatusStatement | null = event
    ? { status: event.status, statusDate: event.localDate, statusAt: event.effectiveAt, source: 'event', prov: event.prov }
    : null
  const fromReport: StatusStatement | null = report?.status
    ? { status: report.status, statusDate: report.localDate, statusAt: report.reportedAt, source: 'report', prov: report.prov }
    : null
  if (fromReport && (!fromEvent || fromReport.statusDate! > fromEvent.statusDate!)) return fromReport
  if (fromReport && fromEvent && fromReport.statusDate === fromEvent.statusDate && fromReport.statusAt && fromReport.statusAt > fromEvent.statusAt!) return fromReport
  return fromEvent ?? { status: null, statusDate: null, statusAt: null, source: null, prov: null }
}

/** Eligibility input: the latest status statement plus the dates of the season containing the date in question. */
export function candidateOps(st: StatusStatement, season: ResortSeasonRow | null | undefined): CandidateOps {
  return {
    status: st.status,
    statusDate: st.statusDate,
    statusAt: st.statusAt,
    announcedOpening: season?.announcedOpening ?? null,
    estimatedOpenFrom: season?.estimatedOpenFrom ?? null,
    estimatedOpenTo: season?.estimatedOpenTo ?? null,
    actualOpening: season?.actualOpening ?? null,
    announcedClosing: season?.announcedClosing ?? null,
    actualClosing: season?.actualClosing ?? null,
  }
}

export interface ClosureView {
  kind: ClosureKind
  /** "Temporarily closed on Fri 15 Jan (reported)", "Closed for the season (closed Sun 11 Apr)"… */
  reason: string
  /** When the closure was stated (status statements only). */
  statedAt: string | null
  prov: Provenance | null
}

/**
 * A confirmed closure on `date` (same rule as recommendation eligibility). `season` must be the resort's row for
 * the season containing `date`. A confirmed closure overrides any ski-day score: show "Closed".
 */
export function closureView(st: StatusStatement, season: ResortSeasonRow | null | undefined, date: string): ClosureView | null {
  const c = confirmedClosure(candidateOps(st, season), date)
  if (!c) return null
  const fromStatus = c.kind === 'closed-for-season' || c.kind === 'temporarily-closed'
  return {
    kind: c.kind,
    reason: c.reason,
    statedAt: fromStatus ? st.statusAt : null,
    prov: fromStatus ? st.prov : c.kind === 'season-ended' ? (season?.actualClosingProv ?? null) : (season?.actualOpeningProv ?? null),
  }
}

// ---------------------------------------------------------------------------
// Opening / closing

export interface OpeningView {
  seasonId: string
  label: OpeningLabel
  date: string | null
  /** End of an estimated window. */
  to: string | null
  /** Days from the resort's today to `date` (negative when past). */
  daysAway: number | null
  /** Announcement wording, verbatim. */
  text: string | null
  /** How an estimate was derived. */
  basis: string | null
  prov: Provenance | null
  announcedOn: string | null
  lastCheckedAt: string | null
  typicalText: string | null
  closing: { label: 'closed' | 'announced' | 'not-announced'; date: string | null; text: string | null; prov: Provenance | null }
}

export function openingView(season: ResortSeasonRow | undefined, seasonId: string, today: string): OpeningView {
  const dates = {
    announcedOpening: season?.announcedOpening ?? null,
    estimatedOpenFrom: season?.estimatedOpenFrom ?? null,
    estimatedOpenTo: season?.estimatedOpenTo ?? null,
    actualOpening: season?.actualOpening ?? null,
    announcedClosing: season?.announcedClosing ?? null,
    actualClosing: season?.actualClosing ?? null,
  }
  const o = openingLabel(dates, today)
  const prov =
    o.label === 'opened'
      ? (season?.actualOpeningProv ?? null)
      : o.label === 'announced'
        ? (season?.announcedOpeningProv ?? null)
        : o.label === 'estimated'
          ? derivedProv('Piste estimate', season?.updatedAt ?? null, season?.estimateBasis ?? null)
          : null
  const closing: OpeningView['closing'] =
    dates.actualClosing && dates.actualClosing <= today
      ? { label: 'closed', date: dates.actualClosing, text: null, prov: season?.actualClosingProv ?? null }
      : dates.announcedClosing || season?.announcedClosingText
        ? { label: 'announced', date: dates.announcedClosing, text: season?.announcedClosingText ?? null, prov: season?.announcedClosingProv ?? null }
        : { label: 'not-announced', date: null, text: null, prov: null }
  return {
    seasonId,
    label: o.label,
    date: o.date,
    to: o.to ?? null,
    daysAway: o.date ? daysUntil(today, o.date) : null,
    text: o.label === 'announced' ? (season?.announcedOpeningText ?? null) : null,
    basis: o.label === 'estimated' ? (season?.estimateBasis ?? null) : null,
    prov,
    announcedOn: season?.announcedOpeningOn ?? null,
    lastCheckedAt: season?.lastCheckedAt ?? null,
    typicalText: season?.typicalOpeningText ?? null,
    closing,
  }
}

// ---------------------------------------------------------------------------
// Conditions score

export interface ScoreView {
  date: string
  mode: ScoringMode
  score: number | null
  scoreKind: ScoreKind
  descriptor: string | null
  confidence: Confidence
  confidenceReasons: string[]
  coverage: number
  eligibility: Eligibility
  surface: SurfaceInterpretation
  components: ComponentResult[]
  explanation: string[]
  leadDays: number | null
  computedAt: string
  modelVersion: string
  kind: DataKind
  prov: Provenance
  /**
   * Set when a confirmed closure overrides the stored assessment for this date: `score`/`descriptor` are then null
   * and `scoreKind` is 'closed' ("Display Closed rather than a misleading ski-day score"). The model's own values
   * are kept here for the explanation drawer only — never show them as a ski-day score.
   */
  supersededByClosure: { reason: string; kind: ClosureKind; modelScore: number | null; modelScoreKind: ScoreKind; modelDescriptor: string | null } | null
}

/** Replace a ski-day score with "Closed" when a closure is confirmed for its date. */
export function applyClosure(score: ScoreView | null, closure: ClosureView | null): ScoreView | null {
  if (!score || !closure) return score
  return {
    ...score,
    score: null,
    descriptor: null,
    scoreKind: 'closed',
    supersededByClosure: { reason: closure.reason, kind: closure.kind, modelScore: score.score, modelScoreKind: score.scoreKind, modelDescriptor: score.descriptor },
  }
}

export function scoreView(a: ConditionsAssessmentRow | undefined): ScoreView | null {
  if (!a) return null
  return {
    date: a.localDate,
    mode: a.mode,
    score: a.score,
    scoreKind: a.scoreKind,
    descriptor: a.descriptor,
    confidence: a.confidence,
    confidenceReasons: a.confidenceReasons,
    coverage: a.coverage,
    eligibility: a.eligibility,
    surface: a.surface,
    components: a.components,
    explanation: a.explanation,
    leadDays: a.leadDays,
    computedAt: a.computedAt,
    modelVersion: a.modelVersion,
    kind: a.kind,
    prov: derivedProv(`Piste Conditions (${a.modelVersion})`, a.computedAt, 'Suitability estimate, not a safety rating', a.kind === 'demo' ? 'demo' : 'derived'),
    supersededByClosure: null,
  }
}

// ---------------------------------------------------------------------------
// Snow

export interface ReportView {
  id: number
  localDate: string
  revision: number
  kind: DataKind
  origin: ReportOrigin
  /** When the source says it published the report (never the fetch time). */
  reportedAt: string | null
  fetchedAt: string | null
  /** Age from the publish time (or the start of its resort-local date when the publish time is unknown). */
  ageHours: number | null
  /** What `ageHours` is measured from. */
  ageBasis: 'published' | 'local-day-start'
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
  prov: Provenance
}

/**
 * `tz` is the resort's IANA zone: without a publish time the age runs from resort-local midnight of the report's
 * date (the earliest it can have been published), never from UTC midnight.
 */
export function reportView(r: OperationalReportRow | undefined, now: string, tz: string): ReportView | null {
  if (!r) return null
  const ref = r.reportedAt ?? startOfLocalDay(r.localDate, tz)
  return {
    id: r.id,
    localDate: r.localDate,
    revision: r.revision,
    kind: r.kind,
    origin: reportOrigin(r),
    reportedAt: r.reportedAt,
    fetchedAt: r.fetchedAt,
    ageHours: Math.max(0, Math.round(hoursBetween(ref, now) * 10) / 10),
    ageBasis: r.reportedAt ? 'published' : 'local-day-start',
    status: r.status,
    snowfall: r.snowfall,
    baseDepthCm: r.baseDepthCm,
    baseDepthLocation: r.baseDepthLocation,
    summitDepthCm: r.summitDepthCm,
    surfaceTags: r.surfaceTags,
    surfaceText: r.surfaceText,
    groomingText: r.groomingText,
    groomedRuns: r.groomedRuns,
    snowmakingText: r.snowmakingText,
    openTrails: r.openTrails,
    totalTrails: r.totalTrails,
    openLifts: r.openLifts,
    totalLifts: r.totalLifts,
    openBeginnerTrails: r.openBeginnerTrails,
    totalBeginnerTrails: r.totalBeginnerTrails,
    openAcres: r.openAcres,
    notes: r.notes,
    prov: r.prov,
  }
}

/** Reported snowfall for one window, if the report states it. */
export function reportedWindow(r: Pick<OperationalReportRow, 'snowfall'> | null | undefined, w: SnowfallReading['window']): number | null {
  const hit = r?.snowfall.find((x) => x.window === w && x.amountCm !== null)
  return hit?.amountCm ?? null
}

export interface RunMeta {
  runId: number
  pointKey: string
  provider: string
  model: string | null
  kind: DataKind
  fetchedAt: string
  /** Model run / issue time only when the provider supplied it. */
  modelRunAt: string | null
  horizonDays: number | null
  timezone: string
  intervalSemantics: WeatherRunRow['intervalSemantics']
  requested: { lat: number; lon: number; elevationM: number | null }
  grid: { lat: number | null; lon: number | null; elevationM: number | null }
  variables: string[]
  units: Record<string, string>
  ageHours: number
  prov: Provenance
}

export function runMeta(r: WeatherRunRow, now: string): RunMeta {
  return {
    runId: r.id,
    pointKey: r.pointKey,
    provider: r.provider,
    model: r.model,
    kind: r.kind,
    fetchedAt: r.fetchedAt,
    modelRunAt: r.modelRunAt,
    horizonDays: r.horizonDays,
    timezone: r.timezone,
    intervalSemantics: r.intervalSemantics,
    requested: { lat: r.requestedLat, lon: r.requestedLon, elevationM: r.requestedElevationM },
    grid: { lat: r.gridLat, lon: r.gridLon, elevationM: r.gridElevationM },
    variables: r.variables,
    units: r.units,
    ageHours: Math.max(0, Math.round(hoursBetween(r.fetchedAt, now) * 10) / 10),
    prov: r.prov,
  }
}

export interface ForecastSnowView {
  pointKey: string
  /** Modeled snowfall over the next 72 h / 7 days (whole hours from the current hour). */
  next72h: SnowSum
  next7d: SnowSum
  run: RunMeta
}

export interface SnowView {
  /** Latest operations report on or before the date. */
  report: ReportView | null
  forecast: { base: ForecastSnowView | null; summit: ForecastSnowView | null }
}

export interface DayWeatherView {
  date: string
  /** Resort-local daily aggregates (modeled). Null when the run does not cover the date. */
  base: DailyWeatherAggregate | null
  summit: DailyWeatherAggregate | null
  baseRun: RunMeta | null
  summitRun: RunMeta | null
}

// ---------------------------------------------------------------------------
// Travel

export interface AirportOption {
  iata: string
  name: string | null
  city: string | null
  role: string | null
  /** Airport → resort ground transfer. */
  minutes: number | null
  km: number | null
  basis: string | null
  officialUrl: string | null
  prov: Provenance | null
}

export interface TransferOption {
  name: string | null
  type: string | null
  url: string | null
  notes: string | null
  prov: Provenance | null
}

export interface TravelView {
  driveMinutes: number | null
  km: number | null
  basis: string | null
  /** Curated estimates are not live routing. */
  isEstimate: boolean
  prov: Provenance | null
  winterBufferPct: number
  /** Drive minutes including the explicit winter planning buffer. */
  winterMinutes: number | null
  airports: AirportOption[]
  transfers: TransferOption[]
  verdict: TravelVerdict
}

const ROLE_ORDER: Record<string, number> = { both: 0, practical: 1, closest: 2 }

export function travelView(b: Bundle, resortId: string): TravelView {
  const opts = b.travel.get(resortId) ?? []
  const drive = opts.find((o) => o.mode === 'drive-from-home') ?? null
  const airports = opts
    .filter((o) => o.mode === 'airport' && o.airportIata)
    .sort((x, y) => (ROLE_ORDER[x.role ?? ''] ?? 9) - (ROLE_ORDER[y.role ?? ''] ?? 9) || (x.minutes ?? 1e9) - (y.minutes ?? 1e9) || x.airportIata!.localeCompare(y.airportIata!))
    .map((o) => {
      const a = b.airports.get(o.airportIata!)
      return { iata: o.airportIata!, name: a?.name ?? null, city: a?.city ?? null, role: o.role, minutes: o.minutes, km: o.km, basis: o.basis, officialUrl: a?.officialUrl ?? null, prov: o.prov }
    })
  const transfers = opts.filter((o) => o.mode === 'transfer').map((o) => ({ name: o.name, type: o.transferType, url: o.url, notes: o.notes, prov: o.prov }))
  const prefs = b.ctx.prefs.travel
  const isEstimate = drive ? drive.prov?.verification !== 'api' : true
  const practical = airports.filter((a) => a.role !== 'closest')
  const verdict = travelVerdict(
    {
      driveMinutes: drive?.minutes ?? null,
      driveIsEstimate: isEstimate,
      airports: (practical.length ? practical : airports).map((a) => a.iata),
      transferMinutes: (practical[0] ?? airports[0])?.minutes ?? null,
    },
    prefs,
  )
  return {
    driveMinutes: drive?.minutes ?? null,
    km: drive?.km ?? null,
    basis: drive?.basis ?? null,
    isEstimate,
    prov: drive?.prov ?? null,
    winterBufferPct: prefs.winterBufferPct,
    winterMinutes: verdict.mode === 'drive' ? verdict.winterMinutes : drive?.minutes != null ? Math.round(drive.minutes * (1 + prefs.winterBufferPct / 100)) : null,
    airports,
    transfers,
    verdict,
  }
}

// ---------------------------------------------------------------------------
// Passes

export interface PassBadgeView {
  familyId: string
  familyName: string
  productIds: string[]
  accessTypes: PassAccessType[]
  /** false when every rule behind the badge is 'unknown' — access not confirmed. */
  confirmed: boolean
  /** Only unknown or discount-only rules: show a muted/qualified badge. */
  qualifiedOnly: boolean
  discoveryOnly: true
}

export function passBadges(b: Bundle, resortId: string): PassBadgeView[] {
  const rules = b.pass.rules.filter((r) => r.resortId === resortId)
  const fam = new Map(b.pass.families.map((f) => [f.id, f.name]))
  return familyBadges(rules, b.pass.products, { seasonId: b.seasonId }).map((x) => ({
    familyId: x.familyId,
    familyName: fam.get(x.familyId) ?? x.familyId,
    productIds: x.productIds,
    accessTypes: x.accessTypes,
    confirmed: !x.accessTypes.every((a) => a === 'unknown'),
    qualifiedOnly: x.qualifiedOnly,
    discoveryOnly: true as const,
  }))
}

/** My owned products (holder 'me') evaluated at a resort on a date. */
export function ownedVerdicts(b: Bundle, resortId: string, date: string): { owned: OwnedPass; verdict: AccessVerdict }[] {
  const today = b.ctx.today
  return b.pass.owned
    .filter((o) => o.ownership.holder === 'me')
    .map((o) => {
      const productRules = b.pass.rules.filter((r) => r.productId === o.product.id)
      return {
        owned: o,
        verdict: evaluateAccess({
          product: o.product,
          rule: latestRule(productRules, o.product.id, resortId),
          resortId,
          date,
          usage: o.usage,
          poolRules: productRules,
          today,
          names: b.names,
        }),
      }
    })
}

export interface MyPassView {
  status: 'covered' | 'not-covered' | 'unconfirmed' | 'no-pass'
  productName: string | null
  headline: string
  verdicts: AccessVerdict[]
}

const STATUS_RANK: Record<string, number> = { included: 0, 'included-limited': 1, unknown: 2, 'discount-only': 3, blackout: 4, 'days-exhausted': 5, 'not-included': 6, 'season-mismatch': 7 }

export function myPassView(verdicts: readonly AccessVerdict[]): MyPassView {
  if (!verdicts.length) return { status: 'no-pass', productName: null, headline: 'No pass recorded', verdicts: [] }
  const sorted = [...verdicts].sort((a, b) => Number(b.canSki) - Number(a.canSki) || (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.productName.localeCompare(b.productName))
  const best = sorted[0]
  const status: MyPassView['status'] = best.canSki ? 'covered' : sorted.some((v) => v.status === 'unknown') ? 'unconfirmed' : 'not-covered'
  const pick = status === 'unconfirmed' ? sorted.find((v) => v.status === 'unknown')! : best
  return { status, productName: pick.productName, headline: `${pick.productName}: ${pick.headline}`, verdicts: sorted }
}

/** The verdict a day basket is priced with: a pass that can be used that day first, else the most telling "not covered". */
export function basketVerdict(verdicts: readonly AccessVerdict[]): AccessVerdict | null {
  return myPassView(verdicts).verdicts[0] ?? null
}

// ---------------------------------------------------------------------------
// Cost

export interface ExpenseView {
  date: string
  tier: ExpenseTier | 'incomplete'
  /** Tier symbol or "Incomplete estimate". */
  label: string
  /** Per person, display currency; null when incomplete. */
  total: Money | null
  totalMax: Money | null
  /** Sum of known lines — itemised display only, never a tier. */
  knownSubtotal: Money
  currency: string
  missing: string[]
  requiredMissing: string[]
  caveats: string[]
  passCoveredBy: string | null
  confirmAtSource: boolean
  dayType: DayBasket['dayType']
  holidayName: string | null
  lines: BasketLine[]
}

export function dayBasket(b: Bundle, resortId: string, date: string, pass: AccessVerdict | null): DayBasket {
  const p = b.ctx.prefs
  const lunch = p.budget.lunchEstimateMinor != null && Number.isInteger(p.budget.lunchEstimateMinor) ? money(p.budget.lunchEstimateMinor, p.budget.currency) : null
  return computeDayBasket(
    { resortId, date, prices: b.prices.get(resortId) ?? [], pass },
    { currency: p.currency, rentalOption: p.gear.rentalOption, lunch, partySize: 1 },
    { now: b.ctx.now, today: b.ctx.today, rates: b.fx },
  )
}

export function expenseView(basket: DayBasket): ExpenseView {
  const passLine = basket.lines.find((l) => l.key === 'lift' && l.kind === 'pass-covered')
  return {
    date: basket.date,
    tier: basket.tier.tier,
    label: basket.label,
    total: basket.total,
    totalMax: basket.totalMax,
    knownSubtotal: basket.knownSubtotal,
    currency: basket.currency,
    missing: basket.missing.map((m) => m.message),
    requiredMissing: basket.missing.filter((m) => m.required).map((m) => m.message),
    caveats: basket.caveats,
    passCoveredBy: passLine?.source ?? null,
    confirmAtSource: basket.lines.some((l) => l.confirmAtSource),
    dayType: basket.dayType,
    holidayName: basket.holidayName,
    lines: basket.lines,
  }
}

// ---------------------------------------------------------------------------
// Beginner info and fit

export interface BeginnerView {
  beginnerPct: number | null
  intermediatePct: number | null
  advancedPct: number | null
  /** Curated learning notes. */
  learning: string | null
  beginnerArea: string | null
  /** null = unknown, false = confirmed not offered. */
  lessons: boolean | null
  rentals: boolean | null
  terrainProv: Provenance | null
  featuresProv: Provenance | null
}

export function beginnerView(r: ResortRow): BeginnerView {
  return {
    beginnerPct: r.terrain?.beginnerPct ?? null,
    intermediatePct: r.terrain?.intermediatePct ?? null,
    advancedPct: r.terrain?.advancedPct ?? null,
    learning: r.learning,
    beginnerArea: r.features?.beginnerArea ?? null,
    lessons: r.features?.lessons ?? null,
    rentals: r.features?.rentals ?? null,
    terrainProv: r.terrain?.prov ?? null,
    featuresProv: r.features?.prov ?? null,
  }
}

export function fitView(
  b: Bundle,
  r: ResortRow,
  travel: TravelView,
  basket: DayBasket | null,
  companion: { name?: string | null; ability: AbilityLevel | null } | null = b.ctx.prefs.companionAbility ? { name: b.ctx.prefs.companionName, ability: b.ctx.prefs.companionAbility } : null,
): FitResult {
  const p = b.ctx.prefs
  const f: FeatureInfo | null = r.features
  return computeFit({
    ability: p.ability,
    companion,
    terrain: r.terrain
      ? { beginnerPct: r.terrain.beginnerPct, intermediatePct: r.terrain.intermediatePct, advancedPct: r.terrain.advancedPct, verification: r.terrain.prov?.verification ?? null }
      : null,
    learning: f ? { lessons: f.lessons, rentals: f.rentals, beginnerArea: f.beginnerArea, learningNotes: r.learning } : r.learning ? { lessons: null, rentals: null, beginnerArea: null, learningNotes: r.learning } : null,
    travel: {
      driveMinutes: travel.driveMinutes,
      driveIsEstimate: travel.isEstimate,
      airports: travel.verdict.mode === 'none' && !travel.airports.length ? [] : travel.airports.filter((a) => a.role !== 'closest').map((a) => a.iata).concat(travel.airports.every((a) => a.role === 'closest') ? travel.airports.map((a) => a.iata) : []),
      transferMinutes: travel.airports.find((a) => a.role !== 'closest')?.minutes ?? travel.airports[0]?.minutes ?? null,
    },
    travelPrefs: p.travel,
    cost: basket ? { total: basket.total, tier: basket.tier.tier } : null,
    dayBudget: p.budget.dayBudgetMinor != null ? money(p.budget.dayBudgetMinor, p.budget.currency) : null,
    needsRental: p.gear.rentalOption !== 'none',
  })
}

// ---------------------------------------------------------------------------
// Events and alerts

export interface EventView {
  id: string
  resortId: string | null
  title: string
  category: string
  venue: string | null
  /** Venue-local wall time, 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'; null when not announced. */
  startLocal: string | null
  endLocal: string | null
  startDate: string | null
  endDate: string | null
  timezone: string
  status: EventRow['status']
  officialUrl: string | null
  ticketUrl: string | null
  price: Money | null
  ageRestriction: string | null
  bookingRequired: boolean | null
  lastVerifiedAt: string | null
  lastEdition: string | null
  prov: Provenance | null
}

export function eventView(e: EventRow): EventView {
  const startDate = e.startLocal?.slice(0, 10) ?? null
  return {
    id: e.id,
    resortId: e.resortId,
    title: e.title,
    category: e.category,
    venue: e.venue,
    startLocal: e.startLocal,
    endLocal: e.endLocal,
    startDate,
    endDate: e.endLocal?.slice(0, 10) ?? startDate,
    timezone: e.timezone,
    status: e.status,
    officialUrl: e.officialUrl,
    ticketUrl: e.ticketUrl,
    price: e.priceMinor != null && e.currency ? money(e.priceMinor, e.currency) : null,
    ageRestriction: e.ageRestriction,
    bookingRequired: e.bookingRequired,
    lastVerifiedAt: e.lastVerifiedAt,
    lastEdition: e.lastEdition,
    prov: e.prov,
  }
}

/** Dated events at the given resorts overlapping [from, to] (inclusive local dates), in date order. */
export function eventsOverlapping(events: readonly EventRow[], resortIds: ReadonlySet<string>, from: string, to: string): EventView[] {
  return events
    .filter((e) => e.resortId && resortIds.has(e.resortId) && e.startLocal)
    .map(eventView)
    .filter((e) => e.startDate! <= to && (e.endDate ?? e.startDate!) >= from)
    .sort((a, b) => (a.startLocal! < b.startLocal! ? -1 : a.startLocal! > b.startLocal! ? 1 : a.title.localeCompare(b.title)))
}

export function eventWindow(date: string, days: number): { from: string; to: string } {
  return { from: addDays(date, -days), to: addDays(date, days) }
}

export interface AlertView {
  id: string
  resortId: string
  provider: string
  event: string
  headline: string | null
  severity: string | null
  onset: string | null
  ends: string | null
  url: string | null
  fetchedAt: string
  /** Onset still in the future. */
  upcoming: boolean
  prov: Provenance
}

export function alertView(a: WeatherAlertRow, now: string): AlertView {
  return {
    id: a.id,
    resortId: a.resortId,
    provider: a.provider,
    event: a.event,
    headline: a.headline,
    severity: a.severity,
    onset: a.onset,
    ends: a.ends,
    url: a.url,
    fetchedAt: a.fetchedAt,
    upcoming: !!a.onset && a.onset > now,
    prov: provenance({ kind: 'official', provider: a.provider, sourceUrl: a.url, fetchedAt: a.fetchedAt, validFrom: a.onset, validTo: a.ends }),
  }
}

/** Alerts overlapping a local day window (missing bounds are unbounded — an alert is never hidden). */
export function alertsOverlapping(alerts: readonly WeatherAlertRow[], fromInstant: string, toInstant: string): WeatherAlertRow[] {
  return alerts.filter((a) => (!a.onset || a.onset < toInstant) && (!a.ends || a.ends > fromInstant))
}

// ---------------------------------------------------------------------------
// Catalog research status

export function catalogResearchGap(r: ResortRow): string | null {
  if (r.research?.method === 'reference-only') return 'Catalog facts are Piste reference data (not web-verified) — confirm at source'
  const open = [r.terrain?.prov, r.features?.prov, r.locationProv, r.elevationProv].filter((p): p is Provenance => !!p && needsConfirmation(p))
  if (!open.length) return null
  // Web-search research is "Researched — confirm at source"; unverified entries are reference data.
  return open.some((p) => p.verification === 'search-summary')
    ? 'Catalog facts are researched from web-search summaries — confirm at source'
    : 'Catalog facts are reference data — confirm at source'
}
