/**
 * Piste Conditions v1 — daily assessment.
 *
 *   score = round( Σ weight × component / Σ available weight )
 *
 * - 'conditions' only when the operational gate passes (surface evidence, terrain status, wind, ≥ 80% weighted
 *   coverage); otherwise 'limited' with component estimates and coverage.
 * - Future dates get a separate 'weather-potential' score from weather-derived components only.
 * - A confirmed closure yields 'closed' with no score. Unknown status is never 'eligible'.
 * - Official alerts pass through as `warnings` and never change the score.
 *
 * Pure: the caller supplies `now`, evidence and weather; nothing here reads a clock, DB or network.
 */
import { addDays, daysBetween, endOfLocalDay, formatLocalDate, localDateOf, startOfLocalDay } from '../time'
import {
  COMPONENT_LABEL,
  DEFAULT_UNITS,
  OPERATING_STATUS_LABEL,
  type ComponentKey,
  type Eligibility,
  type OperatingStatus,
  type ScoreKind,
  type ScoringMode,
  type SurfaceInterpretation,
} from '../types'
import type { OfficialAlert } from '@/lib/providers/types'
import {
  aggregateDay,
  HOUR_MS,
  localWindowMs,
  msToIso,
  prepareSeries,
  slotsWithin,
  toMs,
  type HourlyNumericVariable,
  type PreparedSeries,
} from './aggregate'
import { comfortComponent, surfaceComponent, terrainComponent, visibilityComponent, windComponent, type ComponentContext, type PointPick } from './components'
import { assessConfidence } from './confidence'
import { CONDITIONS_CONFIG_V1 } from './config.v1'
import { localTimeLabel, pct } from './format'
import { interpretSurface, type SurfaceResult } from './surface'
import type {
  AssessDayInput,
  ConditionsComponent,
  ConditionsConfig,
  DayAssessment,
  GateResult,
  OperationsEvidence,
  PointWeather,
  ReportEvidence,
  ScoreDescriptor,
} from './types'

// ---------------------------------------------------------------------------
// Small pure helpers (exported for tests and UI)

export function describeScore(score: number, cfg: ConditionsConfig = CONDITIONS_CONFIG_V1): ScoreDescriptor {
  return (cfg.descriptors.find((d) => score >= d.min) ?? cfg.descriptors[cfg.descriptors.length - 1]).label
}

/** Weighted mean over included components, normalised by the weights actually available. */
export function combineComponents(
  components: readonly ConditionsComponent[],
  mode: ScoringMode,
  cfg: ConditionsConfig = CONDITIONS_CONFIG_V1,
): { score: number | null; coverage: number } {
  const totalNominal = Object.values(cfg.weights[mode]).reduce((a, b) => a + b, 0)
  const used = components.filter((c) => c.included && c.value !== null && c.weight > 0)
  const w = used.reduce((a, c) => a + c.weight, 0)
  const coverage = totalNominal > 0 ? Math.round((w / totalNominal) * 1000) / 1000 : 0
  if (w === 0) return { score: null, coverage }
  return { score: Math.round(used.reduce((a, c) => a + c.weight * c.value!, 0) / w), coverage }
}

// ---------------------------------------------------------------------------
// Operating status → eligibility

interface ResolvedStatus {
  status: OperatingStatus | null
  statusDate: string | null
  statusAt: string | null
}

/**
 * Newest status statement from status events and the report, as known for `date`. Statements about later dates
 * are ignored: a later "open" must not hide a closure confirmed for the date, and a later closure is not this
 * date's status.
 */
function resolveStatus(ops: OperationsEvidence, report: ReportEvidence | null, date: string): ResolvedStatus {
  const candidates: ResolvedStatus[] = []
  if (ops.status) candidates.push({ status: ops.status, statusDate: ops.statusDate, statusAt: ops.statusAt })
  if (report?.status) candidates.push({ status: report.status, statusDate: report.localDate, statusAt: report.reportedAt })
  const relevant = candidates.filter((c) => c.statusDate === null || c.statusDate <= date)
  if (relevant.length === 0) return { status: null, statusDate: null, statusAt: null }
  const closedRank = (s: ResolvedStatus) => (s.status === 'temporarily-closed' || s.status === 'closed-for-season' ? 1 : 0)
  return relevant.sort((a, b) => {
    const d = (b.statusDate ?? '').localeCompare(a.statusDate ?? '')
    if (d !== 0) return d
    // Same date: the newer statement wins; when either time is unknown (or unreadable), a closure wins.
    const ta = a.statusAt ? toMs(a.statusAt) : Number.NaN
    const tb = b.statusAt ? toMs(b.statusAt) : Number.NaN
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta
    return closedRank(b) - closedRank(a)
  })[0]
}

interface EligibilityDecision {
  eligibility: Eligibility
  /** Plain-language status line for the explanation. */
  line: string
}

function decideEligibility(input: AssessDayInput, s: ResolvedStatus, lastForecastDate: string, horizonDays: number): EligibilityDecision {
  const { date, operations: ops, timezone: tz } = input
  const when = (at: string | null, d: string | null) => (at ? localTimeLabel(at, tz, date) : d ? formatLocalDate(d) : 'time not stated')

  // 1. Confirmed closures.
  if (ops.actualClosing && date > ops.actualClosing) {
    return { eligibility: 'closed', line: `Closed for the season — actual closing ${formatLocalDate(ops.actualClosing)}` }
  }
  if (ops.actualOpening && date < ops.actualOpening) {
    return { eligibility: 'closed', line: `Not operating on this date — the season's actual opening was ${formatLocalDate(ops.actualOpening)}` }
  }
  if (s.status === 'temporarily-closed' && s.statusDate === date) {
    return { eligibility: 'closed', line: `Temporarily closed (reported ${when(s.statusAt, s.statusDate)})` }
  }
  if (
    s.status === 'closed-for-season' &&
    s.statusDate !== null &&
    s.statusDate <= date &&
    (!ops.actualOpening || ops.actualOpening <= s.statusDate)
  ) {
    return { eligibility: 'closed', line: `Closed for the season (reported ${when(s.statusAt, s.statusDate)})` }
  }

  // 2. Preseason: no actual opening yet and the date is before any opening.
  if (!ops.actualOpening) {
    if (ops.announcedOpening && date < ops.announcedOpening) {
      return {
        eligibility: 'preseason',
        line: `Not yet open — announced opening ${formatLocalDate(ops.announcedOpening)} (a target, subject to operations and weather)`,
      }
    }
    if (!ops.announcedOpening && ops.estimatedOpenFrom && date < ops.estimatedOpenFrom) {
      return { eligibility: 'preseason', line: `Not yet open — estimated opening from ${formatLocalDate(ops.estimatedOpenFrom)} (Piste estimate)` }
    }
    if (s.status === 'not-yet-open' && s.statusDate === date) {
      return { eligibility: 'preseason', line: `Reported not yet open (${when(s.statusAt, s.statusDate)})` }
    }
  }

  // 3. Beyond the forecast horizon.
  if (date > lastForecastDate) {
    return { eligibility: 'out-of-horizon', line: `Beyond the ${horizonDays}-day forecast range — no score` }
  }

  // 4. Confirmed open for this date.
  if ((s.status === 'open' || s.status === 'partially-open') && s.statusDate === date) {
    return { eligibility: 'eligible', line: `Reported ${OPERATING_STATUS_LABEL[s.status].toLowerCase()} (${when(s.statusAt, s.statusDate)})` }
  }

  // 5. Everything else is unknown — visible, never treated as open.
  if (!s.status || s.status === 'unknown') {
    return { eligibility: 'status-unknown', line: 'Operating status for this date is unknown — not treated as open' }
  }
  return {
    eligibility: 'status-unknown',
    line: `Latest status: ${OPERATING_STATUS_LABEL[s.status]} on ${s.statusDate ? formatLocalDate(s.statusDate) : 'an unknown date'} — status for this date unknown, not treated as open`,
  }
}

// ---------------------------------------------------------------------------

interface PreparedPoint {
  key: string
  series: PreparedSeries
  pw: PointWeather
}

function alertsForDay(alerts: readonly OfficialAlert[], date: string, tz: string): OfficialAlert[] {
  const from = toMs(startOfLocalDay(date, tz))
  const to = toMs(endOfLocalDay(date, tz))
  // A missing or unparseable onset/end counts as unbounded: an official warning is never hidden because its
  // timestamps could not be read.
  const bound = (instant: string | null, unbounded: number) => {
    const ms = instant ? toMs(instant) : Number.NaN
    return Number.isNaN(ms) ? unbounded : ms
  }
  return alerts.filter((a) => bound(a.onset, Number.NEGATIVE_INFINITY) < to && bound(a.ends, Number.POSITIVE_INFINITY) > from)
}

/** True when any slot in the window has a value for any of `vars`. */
function hasAny(series: PreparedSeries, from: number, to: number, vars: readonly HourlyNumericVariable[]): boolean {
  return slotsWithin(series, from, to).some((s) => vars.some((v) => isNum(s.point[v])))
}
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function assessDay(input: AssessDayInput, config: ConditionsConfig = CONDITIONS_CONFIG_V1): DayAssessment {
  const cfg = config
  const tz = input.timezone
  const mode = input.mode
  const units = input.units ?? DEFAULT_UNITS
  const today = localDateOf(input.now, tz)
  const leadDays = daysBetween(today, input.date)
  const isFuture = leadDays > 0
  const hours = input.operatingHours ?? cfg.operatingWindow
  const { fromMs, toMs: endMs } = localWindowMs(input.date, hours.opens, hours.closes, tz)
  const windowLabel = `${hours.opens}–${hours.closes}`
  // Ages are measured to: now (today), the date's lift opening (future), or its lift close (past dates).
  const referenceAt = leadDays === 0 ? input.now : isFuture ? msToIso(fromMs) : msToIso(endMs)

  const hardRuleNotes: string[] = []
  // Demo data never feeds a live assessment; non-operations report kinds are not evidence.
  const live = input.appMode !== 'demo'
  let report = input.report
  if (report && live && report.kind === 'demo') {
    report = null
    hardRuleNotes.push('Demo report ignored: demo data never feeds live assessments')
  } else if (report && !cfg.surface.reportKinds.includes(report.kind)) {
    hardRuleNotes.push(`Report of kind "${report.kind}" is not an operations source and was not used`)
    report = null
  } else if (report && report.localDate > input.date) {
    // Later evidence never rewrites an earlier day: a report for a later date is not this date's surface,
    // terrain or status.
    hardRuleNotes.push(`Report for a later date (${formatLocalDate(report.localDate)}) was not used for this date`)
    report = null
  }

  // Weather points.
  const points: PreparedPoint[] = []
  for (const key of ['base', 'summit'] as const) {
    const pw = input.weather[key]
    if (!pw || pw.hourly.length === 0) continue
    if (live && pw.kind === 'demo') {
      hardRuleNotes.push(`Demo weather for the ${key} point ignored: demo data never feeds live assessments`)
      continue
    }
    points.push({ key, series: prepareSeries(pw.hourly, pw.intervalSemantics), pw })
  }
  // The first point in preference order that has values for the purpose's variables in the window wins, so a
  // preferred point whose run lacks a variable falls back (with a note) instead of dropping the component.
  const pick = (order: readonly string[], from: number, to: number, vars: readonly HourlyNumericVariable[]): PointPick | null => {
    for (const key of order) {
      const p = points.find((x) => x.key === key)
      if (p && hasAny(p.series, from, to, vars)) {
        return { series: p.series, pointKey: key, fallback: key !== order[0], preferredKey: order[0], kind: p.pw.kind }
      }
    }
    return null
  }
  const horizonDays = Math.max(0, ...points.map((p) => p.pw.horizonDays ?? 0)) || cfg.horizon.defaultDays
  const lastForecastDate = addDays(today, horizonDays - 1)

  const warnings = alertsForDay(input.alerts ?? [], input.date, tz)
  if (warnings.length > 0) hardRuleNotes.push('Official alerts are shown separately and are not offset by the score')

  const status = resolveStatus(input.operations, report, input.date)
  const elig = decideEligibility(input, status, lastForecastDate, horizonDays)

  const base = {
    localDate: input.date,
    mode,
    modelVersion: cfg.version,
    computedAt: input.now,
    kind: input.appMode === 'demo' ? ('demo' as const) : ('derived' as const),
    leadDays,
    inputs: input.refs ?? { reportId: null, weatherRunIds: [], statusEventId: null },
    warnings,
  }
  const noGate: GateResult = { passed: false, reasons: [], excluded: [], applied: false }

  const maxLookbackH = Math.max(cfg.surface.freshSnow.lookbackHours, cfg.surface.thawRefreeze.lookbackHours)
  const surfacePick = pick(cfg.points.surface[mode], fromMs - maxLookbackH * HOUR_MS, endMs, ['snowfallCm', 'rainMm', 'temperatureC'])
  const windSurfacePick = pick(cfg.points.wind, endMs - cfg.surface.windAffected.lookbackHours * HOUR_MS, endMs, ['windKmh', 'gustKmh'])
  const computeSurface = (): SurfaceResult =>
    interpretSurface(
      {
        date: input.date,
        timezone: tz,
        referenceAt,
        windowFromMs: fromMs,
        windowToMs: endMs,
        report,
        personal: input.personalFeedback ?? [],
        weather: surfacePick ? { series: surfacePick.series, pointKey: surfacePick.pointKey } : null,
        windWeather: windSurfacePick ? { series: windSurfacePick.series, pointKey: windSurfacePick.pointKey } : null,
        units,
        projecting: isFuture,
      },
      cfg,
    )

  // Short-circuits: closed, preseason, out of horizon.
  if (elig.eligibility === 'closed') {
    const sr = computeSurface()
    return {
      ...base,
      scoreKind: 'closed',
      score: null,
      descriptor: 'Closed',
      coverage: 0,
      components: [],
      surface: sr.surface,
      confidence: 'high',
      confidenceReasons: [`Closure confirmed: ${elig.line}`],
      eligibility: 'closed',
      explanation: [elig.line, 'No ski-day score is shown for a closed resort'],
      hardRuleNotes: ['A confirmed closure overrides any conditions score', ...hardRuleNotes],
      gate: noGate,
    }
  }
  if (elig.eligibility === 'preseason') {
    const sr = computeSurface()
    return {
      ...base,
      scoreKind: 'none',
      score: null,
      descriptor: 'Not yet open',
      coverage: 0,
      components: [],
      surface: sr.surface,
      confidence: 'medium',
      confidenceReasons: ['Opening dates are targets or estimates until the resort reports it is open'],
      eligibility: 'preseason',
      explanation: [elig.line],
      hardRuleNotes: ['An announced opening date does not make the resort open', ...hardRuleNotes],
      gate: noGate,
    }
  }
  if (elig.eligibility === 'out-of-horizon') {
    const none: SurfaceInterpretation = { tags: ['unknown'], basis: 'none', text: 'Unknown — beyond the forecast range', rules: [] }
    return {
      ...base,
      scoreKind: 'none',
      score: null,
      descriptor: null,
      coverage: 0,
      components: [],
      surface: none,
      confidence: 'low',
      confidenceReasons: ['Beyond the forecast horizon'],
      eligibility: 'out-of-horizon',
      explanation: [elig.line],
      hardRuleNotes,
      gate: noGate,
    }
  }

  // Components.
  const sr = computeSurface()
  const cctx: ComponentContext = {
    mode,
    cfg,
    date: input.date,
    timezone: tz,
    referenceAt,
    windowFromMs: fromMs,
    windowToMs: endMs,
    windowLabel,
    units,
    surface: sr,
    report,
    wind: pick(cfg.points.wind, fromMs, endMs, ['windKmh', 'gustKmh']),
    // Direct visibility at any point before the cloud-cover proxy.
    visibility: pick(cfg.points.visibility, fromMs, endMs, ['visibilityM']) ?? pick(cfg.points.visibility, fromMs, endMs, ['cloudCoverPct']),
    comfort: pick(cfg.points.comfort[mode], fromMs, endMs, ['apparentTemperatureC', 'temperatureC']),
    terrainUnknownReason: isFuture ? 'Terrain and open status for future dates are unknown (not projected from today’s report)' : null,
  }
  const builds = [surfaceComponent(cctx), terrainComponent(cctx), windComponent(cctx), visibilityComponent(cctx), comfortComponent(cctx)]
  hardRuleNotes.push(...builds.flatMap((b) => b.hardRuleNotes))
  const components = builds.map((b) => b.component)
  const { score, coverage } = combineComponents(components, mode, cfg)
  const byKey = (k: ComponentKey) => components.find((c) => c.key === k)!
  const excluded = components.filter((c) => !c.included).map((c) => c.key)

  let scoreKind: ScoreKind
  let finalScore: number | null = score
  let descriptor: string | null
  let gate: GateResult
  const explanation: string[] = [elig.line]

  if (isFuture) {
    gate = { ...noGate, excluded }
    const weatherOnly = (['W', 'V', 'C'] as const).some((k) => byKey(k).included)
    if (!weatherOnly) {
      scoreKind = 'none'
      finalScore = null
      descriptor = null
      explanation.push('No weather forecast for this date — no weather potential score')
    } else {
      scoreKind = 'weather-potential'
      descriptor = finalScore === null ? null : describeScore(finalScore, cfg)
      explanation.push(
        'Weather potential only: assumes the resort operates; open terrain and operating status for this date are unknown',
        `Forecast ${leadDays} day${leadDays === 1 ? '' : 's'} ahead (modeled weather)`,
      )
    }
  } else {
    const reasons: string[] = []
    const S = byKey('S')
    if (!S.included) reasons.push('no surface evidence')
    else if (!cfg.gate.surfaceEvidenceBases.includes(sr.surface.basis)) reasons.push('surface is inferred from weather, not reported')
    if (cfg.gate.requireTerrain && !byKey('T').included) reasons.push('terrain status not reported for this date')
    if (cfg.gate.requireWind && !byKey('W').included) reasons.push('no wind data')
    if (coverage < cfg.gate.minCoverage) reasons.push(`weighted input coverage ${pct(coverage)} is below ${pct(cfg.gate.minCoverage)}`)
    gate = { passed: reasons.length === 0, reasons, excluded, applied: true }
    if (gate.passed) {
      scoreKind = 'conditions'
      descriptor = finalScore === null ? null : describeScore(finalScore, cfg)
    } else {
      scoreKind = 'limited'
      descriptor = 'Limited data'
      if (coverage < cfg.limited.minCoverageForEstimate) finalScore = null
      explanation.push(`Limited data: ${reasons.join('; ')}`)
    }
  }

  if (elig.eligibility === 'status-unknown') hardRuleNotes.push('Operating status for this date is unknown and is not treated as open')

  for (const c of components) if (c.included) explanation.push(c.note)
  for (const c of components) if (!c.included) explanation.push(`Not scored — ${COMPONENT_LABEL[c.key]}: ${c.note}`)
  explanation.push(`Inputs cover ${pct(coverage)} of the weighted model`)
  explanation.push(...sr.notes)
  if (sr.management?.groomingText || (sr.management?.groomedRuns ?? null) !== null) {
    const g = sr.management!
    explanation.push(`Grooming (reported, separate from surface): ${g.groomingText ?? `${g.groomedRuns} runs groomed`}`)
  }
  if (sr.management?.snowmakingText) explanation.push(`Snowmaking (reported, separate from surface): ${sr.management.snowmakingText}`)

  // Confidence.
  const usedPoints = [surfacePick, cctx.wind, cctx.visibility, cctx.comfort].filter((p): p is PointPick => p !== null)
  const usedWeather = points.filter((p) => usedPoints.some((u) => u.pointKey === p.key))
  const fetched = usedWeather.map((p) => p.pw.fetchedAt)
  const weatherFetchedAt = fetched.length === 0 || fetched.some((x) => !x) ? null : fetched.map((x) => x!).sort()[0]
  const primary = surfacePick ? aggregateDay(surfacePick.series, input.date, tz) : null
  const conf = assessConfidence(
    {
      surface: sr,
      coverage,
      leadDays: Math.max(0, leadDays),
      now: input.now,
      weatherFetchedAt,
      hasWeather: usedWeather.length > 0,
      // Only a full day of primary snowfall is comparable with the alternate model's daily total.
      primarySnowfallCm: primary && (primary.variableCoverage.snowfallCm ?? 0) >= 1 ? primary.snowfallCm : null,
      alternate: input.alternateModel ?? null,
      units,
    },
    cfg,
  )

  return {
    ...base,
    scoreKind,
    score: finalScore,
    descriptor,
    coverage,
    components,
    surface: sr.surface,
    confidence: conf.confidence,
    confidenceReasons: conf.reasons,
    eligibility: elig.eligibility,
    explanation,
    hardRuleNotes,
    gate,
  }
}
