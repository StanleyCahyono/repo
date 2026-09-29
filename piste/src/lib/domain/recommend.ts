/**
 * "Where to ski" — rank resorts for a date or a date range with presets.
 *
 * 1. Eligibility FIRST, per resort and date (before any scoring):
 *    - confirmed closures and closed-for-season are excluded;
 *    - not-yet-open / preseason resorts are excluded ("Not open yet — opens … / opening not announced");
 *    - 'unknown' status is never treated as open: those resorts go to a separate `statusUnknown` group that is
 *      ranked for planning but can never be the winner;
 *    - a future in-season date is "expected open" only when the resort has actually opened this season and has
 *      no reported closure — the assumption and the status age are stated.
 * 2. Eligible options are scored with the preset's factor weights over conditions, fit, travel, cost and events
 *    (each 0–100). Unknown factors count at UNKNOWN_FACTOR_VALUE (below neutral) and are listed as limitations.
 * 3. Deterministic ordering: total, then known-factor count, conditions, travel time, date, resort id.
 *
 * Official alerts are carried beside each option and never change or offset the score. Demo-kind conditions
 * never feed a live recommendation. Pure: callers pass the clock and every input.
 */
import { evalCurve } from './conditions/curve'
import type { Curve } from './conditions/types'
import { ageLabel } from './conditions/format'
import type { FitResult, TravelVerdict } from './fit'
import { formatMoney, type Money } from './money'
import { formatLocalDate, hoursBetween, seasonIdFor } from './time'
import {
  OPERATING_STATUS_LABEL,
  SCORING_MODE_LABEL,
  type AppMode,
  type Confidence,
  type DataKind,
  type ExpenseTier,
  type OperatingStatus,
  type ScoreKind,
  type ScoringMode,
  type UnitPrefs,
} from './types'
import { formatDuration, formatSnow } from './units'

// ---------------------------------------------------------------------------
// Presets

export const RECOMMEND_PRESETS = ['learning', 'best-snow', 'lowest-cost', 'short-drive', 'apres-weekend', 'custom'] as const
export type RecommendPreset = (typeof RECOMMEND_PRESETS)[number]

export const PRESET_LABEL: Record<RecommendPreset, string> = {
  learning: 'Learning day',
  'best-snow': 'Best snow',
  'lowest-cost': 'Lowest total cost',
  'short-drive': 'Short drive',
  'apres-weekend': 'Après weekend',
  custom: 'My weights',
}

export const FACTOR_KEYS = ['conditions', 'fit', 'travel', 'cost', 'events'] as const
export type FactorKey = (typeof FACTOR_KEYS)[number]
export type FactorWeights = Record<FactorKey, number>

export const FACTOR_LABEL: Record<FactorKey, string> = {
  conditions: 'Conditions',
  fit: 'Fit for me',
  travel: 'Travel time',
  cost: 'Total cost',
  events: 'Events',
}

/** Factor weights (percent) per preset. 'custom' uses the user's saved weights. */
export const PRESET_WEIGHTS: Record<Exclude<RecommendPreset, 'custom'>, FactorWeights> = {
  learning: { conditions: 25, fit: 45, travel: 15, cost: 15, events: 0 },
  'best-snow': { conditions: 60, fit: 10, travel: 15, cost: 10, events: 5 },
  'lowest-cost': { conditions: 15, fit: 15, travel: 15, cost: 55, events: 0 },
  'short-drive': { conditions: 20, fit: 15, travel: 55, cost: 10, events: 0 },
  'apres-weekend': { conditions: 25, fit: 15, travel: 15, cost: 10, events: 35 },
}

/** Conditions scoring modes to read, in preference order (first with a score wins). */
export const PRESET_MODES: Record<Exclude<RecommendPreset, 'custom'>, readonly ScoringMode[]> = {
  learning: ['learning'],
  'best-snow': ['powder', 'all-mountain'],
  'lowest-cost': ['learning', 'all-mountain'],
  'short-drive': ['learning', 'all-mountain'],
  'apres-weekend': ['all-mountain', 'learning'],
}

/** Unknown factors count at this value — below neutral, so a gap never helps a resort win. */
export const UNKNOWN_FACTOR_VALUE = 40
export const MAX_ALTERNATIVES = 3

/** Winter drive minutes → travel value. Flying is always a long trip. */
const TRAVEL_CURVE: Curve = [
  [0, 100],
  [45, 95],
  [90, 85],
  [150, 70],
  [240, 50],
  [360, 30],
  [480, 15],
  [720, 0],
]
export const FLY_FACTOR_VALUE = 10
/** Per-person day basket (USD minor units) → cost value. Other currencies use the tier. */
const COST_CURVE_USD: Curve = [
  [0, 100],
  [6_000, 90],
  [12_500, 75],
  [25_000, 45],
  [45_000, 15],
  [70_000, 0],
]
const COST_TIER_VALUE: Record<ExpenseTier, number> = { $: 85, $$: 65, $$$: 40, $$$$: 15 }
const EVENTS_VALUE = (n: number) => (n <= 0 ? 25 : n === 1 ? 75 : n === 2 ? 90 : 100)

/** Age thresholds for evidence limitations (hours). */
const REPORT_AGE_NOTE_H = 12
const WEATHER_AGE_NOTE_H = 12

// ---------------------------------------------------------------------------
// Inputs

export interface CandidateOps {
  /** Latest operating-status statement (status events and reports), with the resort-local date it applies to. */
  status: OperatingStatus | null
  statusDate: string | null
  statusAt: string | null
  /** Season dates for the season of the dates being ranked. */
  announcedOpening: string | null
  estimatedOpenFrom: string | null
  estimatedOpenTo: string | null
  actualOpening: string | null
  announcedClosing: string | null
  actualClosing: string | null
}

export interface CandidateConditions {
  score: number | null
  scoreKind: ScoreKind
  descriptor: string | null
  confidence: Confidence | null
  computedAt: string | null
  kind: DataKind
}

export interface CandidateCost {
  /** Per-person day basket in the display currency; null when incomplete. */
  total: Money | null
  tier: ExpenseTier | 'incomplete'
  /** Missing required items, plain language. */
  missing: string[]
  /** Research-grade prices were used. */
  confirmAtSource?: boolean
}

export interface CandidatePass {
  /** covered = an owned pass can be used; unconfirmed = access rules not confirmed; no-pass = none owned. */
  status: 'covered' | 'not-covered' | 'unconfirmed' | 'no-pass'
  productName: string | null
  note?: string | null
}

export interface CandidateDay {
  date: string
  /** Latest stored assessment per scoring mode for this date. */
  conditions: Partial<Record<ScoringMode, CandidateConditions | null>>
  cost: CandidateCost | null
  pass: CandidatePass | null
  /** Events at/near the resort on this date (any status; only announced/tentative count). */
  events: readonly { title: string; status: string }[]
  /**
   * Explanation-only snow context. `forecast72hComplete: false` means the model run covers only part of the
   * 72 h, so the sum is a lower bound ("at least …"), never a full total.
   */
  snow?: { forecast72hCm: number | null; forecast72hComplete?: boolean | null; reported24hCm: number | null } | null
  /** Official alert headlines overlapping the day — shown, never scored. */
  warnings?: readonly string[]
}

export interface CandidateEvidence {
  /** Publish time of the latest report used (never the fetch time). */
  reportAt: string | null
  reportDate: string | null
  reportKind: DataKind | null
  weatherFetchedAt: string | null
  /** Catalog facts (terrain, prices, drive times) are web research — confirm at source. */
  catalogResearched?: boolean
}

export interface RecommendCandidate {
  resortId: string
  name: string
  /** Resort-local "today" (from the app clock). */
  today: string
  ops: CandidateOps
  fit: FitResult | null
  travel: TravelVerdict | null
  evidence: CandidateEvidence
  days: readonly CandidateDay[]
}

export interface RecommendInput {
  candidates: readonly RecommendCandidate[]
  /** Resort-local dates to consider (a single date or a range). */
  dates: readonly string[]
  preset: RecommendPreset
  /** Saved user weights: used by 'custom', and override preset weights when `overrideWeights` is true. */
  weights?: Partial<FactorWeights> | null
  overrideWeights?: boolean
  /** Scoring mode for 'custom' (defaults to the user's preferred mode). */
  defaultMode?: ScoringMode
  now: string
  appMode?: AppMode
  /** Display units for explanation text (snow amounts); centimetres when not given. */
  units?: UnitPrefs | null
}

// ---------------------------------------------------------------------------
// Outputs

export type OptionEligibility = 'confirmed-open' | 'expected-open' | 'status-unknown'

export interface FactorScore {
  key: FactorKey
  label: string
  /** Normalised weight (0–1) actually applied. */
  weight: number
  /** 0–100, or null when unknown. */
  value: number | null
  /** Value used in the total (UNKNOWN_FACTOR_VALUE when unknown). */
  used: number
  known: boolean
  note: string
}

export interface RankedOption {
  resortId: string
  name: string
  date: string
  rank: number
  /** Weighted total 0–100 (one decimal). */
  total: number
  eligibility: OptionEligibility
  /** Plain-language status line ("Reported open for Sat 16 Jan", "Expected open — …", "Status unknown — …"). */
  statusNote: string
  /** The assumption made for an expected-open date (null when confirmed or unknown). */
  assumption: string | null
  conditionsMode: ScoringMode | null
  factors: FactorScore[]
  benefits: string[]
  tradeoffs: string[]
  limitations: string[]
  /** Official alerts — shown independently of the score. */
  warnings: string[]
  /** Other dates in the range and their totals (for range searches). */
  otherDates: { date: string; total: number | null; eligibility: OptionEligibility | 'excluded'; note: string }[]
}

export interface ExcludedResort {
  resortId: string
  name: string
  reason: string
  kind: 'closed' | 'preseason' | 'travel'
}

export interface Recommendation {
  preset: RecommendPreset
  presetLabel: string
  weights: FactorWeights
  dates: string[]
  winner: RankedOption | null
  alternatives: RankedOption[]
  /** All eligible options in rank order (winner first). */
  ranked: RankedOption[]
  excluded: ExcludedResort[]
  /** Resorts whose status on the dates is unknown — ranked for planning, never the winner. */
  statusUnknown: RankedOption[]
  explanation: { benefits: string[]; tradeoffs: string[] }
  evidenceLimitations: string[]
  /** No resort has opened yet this season: show opening watch instead of a winner. */
  preseason: boolean
  /** Why there is no winner, built from the actual exclusion reasons (null when there is a winner). */
  noWinnerReason: string | null
  /** Set when the requested weights could not be used (e.g. custom weights all zero). */
  weightsNote: string | null
}

// ---------------------------------------------------------------------------
// Eligibility

type DayClass =
  | { kind: 'closed' | 'preseason' | 'travel'; reason: string }
  | { kind: OptionEligibility; note: string; assumption: string | null }

const fmt = (d: string) => formatLocalDate(d)
const isOpenStatus = (s: OperatingStatus | null) => s === 'open' || s === 'partially-open'

/** Has the resort actually opened in the season containing `date` (as of its local today)? */
export function hasOpenedThisSeason(c: RecommendCandidate, date: string = c.today): boolean {
  const o = c.ops
  const season = seasonIdFor(date)
  if (o.actualOpening && o.actualOpening <= c.today && seasonIdFor(o.actualOpening) === season) return true
  return isOpenStatus(o.status) && !!o.statusDate && o.statusDate <= c.today && seasonIdFor(o.statusDate) === season
}

export type ClosureKind = 'season-ended' | 'before-opening' | 'closed-for-season' | 'temporarily-closed'

export interface ConfirmedClosure {
  kind: ClosureKind
  /** Plain-language reason, e.g. "Temporarily closed on Fri 15 Jan (reported)". */
  reason: string
}

/**
 * Did a 'closed-for-season' statement dated `sd` close the season that contains it? With an actual opening on
 * record the statement must come after it. Without one, a statement dated before this season's announced (or
 * estimated) opening is a leftover about the previous season — e.g. a report page still reading "closed for the
 * season" over the summer — and closes nothing.
 */
function closesThisSeason(o: CandidateOps, sd: string): boolean {
  if (o.actualOpening && seasonIdFor(o.actualOpening) === seasonIdFor(sd)) return o.actualOpening <= sd
  const start = o.announcedOpening ?? o.estimatedOpenFrom
  return !start || seasonIdFor(start) !== seasonIdFor(sd) || sd >= start
}

/**
 * A confirmed closure for `date`, or null. `o` carries the latest status statement and the dates of the season
 * containing `date`. Shared by recommendation eligibility and the read models, where a confirmed closure replaces
 * the ski-day score with "Closed" (brief §5).
 *
 * - after the recorded actual closing, or before the recorded actual opening;
 * - 'closed-for-season' reported on or before `date` in the SAME season, after that season's opening — last
 *   season's April closure is not a closure of the new season;
 * - 'temporarily-closed' reported for that very date.
 */
export function confirmedClosure(o: CandidateOps, date: string): ConfirmedClosure | null {
  const s = o.status
  const sd = o.statusDate
  if (o.actualClosing && date > o.actualClosing) return { kind: 'season-ended', reason: `Closed for the season (closed ${fmt(o.actualClosing)})` }
  if (o.actualOpening && date < o.actualOpening) {
    return { kind: 'before-opening', reason: `Not operating on ${fmt(date)} — the season opened ${fmt(o.actualOpening)}` }
  }
  if (s === 'closed-for-season' && sd && sd <= date && seasonIdFor(sd) === seasonIdFor(date) && closesThisSeason(o, sd)) {
    return { kind: 'closed-for-season', reason: `Closed for the season (reported ${fmt(sd)})` }
  }
  if (s === 'temporarily-closed' && sd === date) return { kind: 'temporarily-closed', reason: `Temporarily closed on ${fmt(date)} (reported)` }
  return null
}

/** Classify one resort-date. Eligibility is decided before any factor is scored. */
export function classifyDay(c: RecommendCandidate, day: CandidateDay | undefined, date: string, now: string): DayClass {
  const o = c.ops
  const s = o.status
  const sd = o.statusDate

  // 1. Confirmed closures.
  const closure = confirmedClosure(o, date)
  if (closure) return { kind: 'closed', reason: closure.reason }
  const assessed = day ? Object.values(day.conditions).find((x) => x && x.scoreKind === 'closed') : null
  if (assessed) return { kind: 'closed', reason: 'Closure confirmed in the conditions assessment for this date' }

  // 2. Not opened yet this season → preseason (or unknown once the announced target has passed).
  const opened = hasOpenedThisSeason(c, date)
  if (!opened) {
    if (s === 'not-yet-open' && sd === date) return { kind: 'preseason', reason: `Not open yet — reported not yet open for ${fmt(date)}` }
    if (o.announcedOpening && date < o.announcedOpening) {
      return { kind: 'preseason', reason: `Not open yet — opens ${fmt(o.announcedOpening)} (announced target, subject to conditions)` }
    }
    if (!o.announcedOpening) {
      const est =
        o.estimatedOpenFrom && o.estimatedOpenTo
          ? ` (Piste estimate ${fmt(o.estimatedOpenFrom)} – ${fmt(o.estimatedOpenTo)})`
          : o.estimatedOpenFrom
            ? ` (Piste estimate from ${fmt(o.estimatedOpenFrom)})`
            : ''
      return { kind: 'preseason', reason: `Not open yet — opening not announced${est}` }
    }
    return {
      kind: 'status-unknown',
      note: `Status unknown — the announced opening (${fmt(o.announcedOpening)}) is a target and no opening has been reported`,
      assumption: null,
    }
  }

  // 3. Opened this season. Statements from before the opening are not about this season.
  const current = s && sd && (!o.actualOpening || sd >= o.actualOpening) ? s : null
  if (isOpenStatus(current) && sd === date) {
    return { kind: 'confirmed-open', note: `Reported ${OPERATING_STATUS_LABEL[current!].toLowerCase()} for ${fmt(date)}`, assumption: null }
  }
  if (date < c.today) return { kind: 'status-unknown', note: `No status was reported for ${fmt(date)}`, assumption: null }
  if (current === 'temporarily-closed') {
    return { kind: 'status-unknown', note: `Status unknown — temporarily closed as of ${fmt(sd!)}; reopening not reported`, assumption: null }
  }
  if (current === 'unknown') return { kind: 'status-unknown', note: 'Status unavailable — not treated as open', assumption: null }
  if (current === 'not-yet-open') return { kind: 'status-unknown', note: `Status unknown — latest report says not yet open (${fmt(sd!)})`, assumption: null }
  if (o.announcedClosing && date > o.announcedClosing) {
    return { kind: 'status-unknown', note: `Status unknown — after the announced closing date (${fmt(o.announcedClosing)})`, assumption: null }
  }
  const age = o.statusAt ? ageLabel(Math.max(0, hoursBetween(o.statusAt, now))) : null
  const assumption =
    isOpenStatus(current) && age
      ? `Assumes ${c.name} is still operating on ${fmt(date)} — latest status ${OPERATING_STATUS_LABEL[current!]} reported ${age} ago`
      : `Assumes ${c.name} is still operating on ${fmt(date)} — opened ${o.actualOpening ? fmt(o.actualOpening) : 'this season'}, no closure reported${age ? ` (latest status ${age} old)` : ''}`
  return { kind: 'expected-open', note: `Expected open (assumption) — opened this season, no closure reported`, assumption }
}

// ---------------------------------------------------------------------------
// Factors

function resolveWeights(input: RecommendInput): { weights: FactorWeights; note: string | null } {
  const preset = input.preset
  const base: FactorWeights =
    preset === 'custom' ? { conditions: 0, fit: 0, travel: 0, cost: 0, events: 0 } : { ...PRESET_WEIGHTS[preset] }
  const user = input.weights ?? null
  if (user && (preset === 'custom' || input.overrideWeights)) {
    for (const k of FACTOR_KEYS) {
      const v = user[k]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) base[k] = v
    }
  }
  const sum = FACTOR_KEYS.reduce((a, k) => a + base[k], 0)
  if (sum <= 0) {
    return { weights: { ...PRESET_WEIGHTS.learning }, note: `Your weights are all zero — ranked with the ${PRESET_LABEL.learning} weights instead` }
  }
  return { weights: base, note: null }
}

function modesFor(input: RecommendInput): readonly ScoringMode[] {
  if (input.preset === 'custom') return [input.defaultMode ?? 'learning', 'all-mountain', 'learning'].filter((m, i, a) => a.indexOf(m) === i) as ScoringMode[]
  return PRESET_MODES[input.preset]
}

interface FactorBuild {
  value: number | null
  note: string
  limitation?: string | null
}

function conditionsFactor(day: CandidateDay | undefined, modes: readonly ScoringMode[], live: boolean): FactorBuild & { mode: ScoringMode | null } {
  if (!day) return { value: null, note: 'No conditions assessment', limitation: 'No conditions score for this date', mode: null }
  for (const m of modes) {
    const c = day.conditions[m]
    if (!c || c.score === null || (live && c.kind === 'demo')) continue
    const label = SCORING_MODE_LABEL[m]
    if (c.scoreKind === 'conditions') return { value: c.score, note: `Conditions ${c.score} (${c.descriptor ?? '—'}) · ${label}`, mode: m }
    if (c.scoreKind === 'weather-potential') {
      return {
        value: c.score,
        note: `Weather potential ${c.score} (${c.descriptor ?? '—'}) · ${label}`,
        limitation: `Weather potential only for ${fmt(day.date)} — open terrain and operating status are unknown`,
        mode: m,
      }
    }
    if (c.scoreKind === 'limited') {
      return { value: c.score, note: `Limited-data estimate ${c.score} · ${label}`, limitation: `Conditions score for ${fmt(day.date)} is based on limited data`, mode: m }
    }
  }
  return { value: null, note: 'No conditions score for this date', limitation: `No conditions score for ${fmt(day.date)}`, mode: null }
}

function fitFactor(fit: FitResult | null): FactorBuild {
  if (!fit || fit.score === null) return { value: null, note: 'Fit unknown — too little known', limitation: 'Fit for me: not enough information' }
  const lim = fit.unknowns.length ? `Fit for me: ${fit.unknowns.length} input${fit.unknowns.length === 1 ? '' : 's'} unknown (${fit.unknowns[0].split(' — ')[0].toLowerCase()})` : null
  return { value: fit.rankValue, note: `${fit.label} (${fit.score})`, limitation: lim }
}

function travelFactor(t: TravelVerdict | null): FactorBuild {
  if (!t || t.feasible === null) return { value: null, note: 'Travel time unknown', limitation: 'No drive or airport information recorded' }
  if (t.mode === 'fly') return { value: FLY_FACTOR_VALUE, note: 'Flight needed — a long trip', limitation: 'Door-to-door time for a fly-in trip is not estimated' }
  if (t.winterMinutes === null) return { value: null, note: 'Travel time unknown', limitation: 'Drive time unknown' }
  return {
    value: Math.round(evalCurve(TRAVEL_CURVE, t.winterMinutes)),
    note: `${t.isEstimate ? 'About ' : ''}${formatDuration(t.driveMinutes)} drive (${formatDuration(t.winterMinutes)} with winter buffer)`,
    limitation: t.isEstimate ? 'Drive time is a curated estimate, not live routing' : null,
  }
}

function costFactor(cost: CandidateCost | null): FactorBuild {
  if (!cost || cost.tier === 'incomplete' || (!cost.total && !cost.tier)) {
    const missing = cost?.missing.length ? ` (${cost.missing.join('; ')})` : ''
    return { value: null, note: 'Cost estimate incomplete', limitation: `Cost estimate incomplete${missing}` }
  }
  const lim = cost.confirmAtSource ? 'Prices are researched — confirm at source' : null
  if (cost.total && cost.total.currency === 'USD') {
    return { value: Math.round(evalCurve(COST_CURVE_USD, cost.total.amountMinor)), note: `${formatMoney(cost.total)} per person (${cost.tier})`, limitation: lim }
  }
  return { value: COST_TIER_VALUE[cost.tier], note: `Expense tier ${cost.tier}${cost.total ? ` (${formatMoney(cost.total)} per person)` : ''}`, limitation: lim }
}

function eventsFactor(day: CandidateDay | undefined): FactorBuild {
  const live = (day?.events ?? []).filter((e) => e.status === 'announced' || e.status === 'tentative')
  if (!live.length) return { value: EVENTS_VALUE(0), note: 'No events on file for these dates (not proof there are none)' }
  const names = live.slice(0, 2).map((e) => e.title + (e.status === 'tentative' ? ' (tentative)' : ''))
  return { value: EVENTS_VALUE(live.length), note: `${live.length} event${live.length === 1 ? '' : 's'}: ${names.join(', ')}${live.length > 2 ? '…' : ''}` }
}

interface Scored {
  option: Omit<RankedOption, 'rank' | 'otherDates'>
  raw: number
  knownCount: number
  conditionsUsed: number
  travelMinutes: number | null
}

function scoreDay(c: RecommendCandidate, day: CandidateDay | undefined, date: string, cls: Extract<DayClass, { note: string }>, input: RecommendInput, weights: FactorWeights): Scored {
  const live = input.appMode !== 'demo'
  const cond = conditionsFactor(day, modesFor(input), live)
  const builds: Record<FactorKey, FactorBuild> = {
    conditions: cond,
    fit: fitFactor(c.fit),
    travel: travelFactor(c.travel),
    cost: costFactor(day?.cost ?? null),
    events: eventsFactor(day),
  }
  const sum = FACTOR_KEYS.reduce((a, k) => a + weights[k], 0)
  const factors: FactorScore[] = FACTOR_KEYS.filter((k) => weights[k] > 0).map((k) => {
    const b = builds[k]
    const value = b.value === null ? null : Math.max(0, Math.min(100, Math.round(b.value)))
    return {
      key: k,
      label: FACTOR_LABEL[k],
      weight: Math.round((weights[k] / sum) * 1000) / 1000,
      value,
      used: value ?? UNKNOWN_FACTOR_VALUE,
      known: value !== null,
      note: value === null ? `${b.note} — counted below neutral` : b.note,
    }
  })
  const raw = factors.reduce((a, f) => a + (weights[f.key] / sum) * f.used, 0)

  // Benefits / trade-offs / limitations for this option.
  const benefits: string[] = []
  const tradeoffs: string[] = []
  const byImpact = [...factors].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
  for (const f of byImpact) {
    if (!f.known || f.weight < 0.1) continue
    if (f.used >= 70) benefits.push(f.note)
    else if (f.used < 50) tradeoffs.push(f.note)
  }
  if (c.fit && weights.fit > 0) {
    const pos = c.fit.components.filter((x) => x.known && x.used >= 75).map((x) => x.note)
    const neg = c.fit.components.filter((x) => x.known && x.used < 45).map((x) => x.note)
    if (c.fit.cappedBy) neg.unshift(c.fit.cappedBy)
    for (const p of pos.slice(0, 2)) if (!benefits.includes(p)) benefits.push(p)
    for (const n of neg.slice(0, 2)) if (!tradeoffs.includes(n)) tradeoffs.push(n)
  }
  if (day?.snow?.forecast72hCm != null && day.snow.forecast72hCm >= 5) {
    const cm = day.snow.forecast72hCm
    const amount = input.units ? formatSnow(cm, input.units) : `${Math.round(cm)} cm`
    // A run that covers only part of the 72 h gives a lower bound, never a full total.
    benefits.push(
      day.snow.forecast72hComplete === false
        ? `Likely at least ${amount} new snow in the next 72 h (weather model; the forecast covers only part of the window)`
        : `Likely ${amount} new snow in the next 72 h (weather model)`,
    )
  }
  if (day?.pass?.status === 'covered' && day.pass.productName) benefits.push(`Lift access covered by your ${day.pass.productName}`)
  if (day?.pass?.status === 'not-covered' && day.pass.productName) tradeoffs.push(`Not covered by your ${day.pass.productName}${day.pass.note ? `: ${day.pass.note}` : ''}`)
  const warnings = [...(day?.warnings ?? [])]
  for (const w of warnings) tradeoffs.unshift(`Official alert: ${w}`)

  const limitations: string[] = []
  const add = (s: string | null | undefined) => {
    if (s && !limitations.includes(s)) limitations.push(s)
  }
  if (cls.assumption) add(cls.assumption)
  add(evidenceLimitation(c.evidence, date, input.now))
  add(weatherLimitation(c.evidence, input.now))
  for (const k of FACTOR_KEYS) if (weights[k] > 0) add(builds[k].limitation)
  if (day?.pass?.status === 'unconfirmed') add(`Pass access unconfirmed${day.pass.productName ? ` for ${day.pass.productName}` : ''} — check the official page`)
  if (c.evidence.catalogResearched) add('Catalog facts (terrain, prices, drive times) are researched — confirm at source')

  const knownCount = factors.filter((f) => f.known).length
  return {
    option: {
      resortId: c.resortId,
      name: c.name,
      date,
      total: Math.round(raw * 10) / 10,
      eligibility: cls.kind,
      statusNote: cls.note,
      assumption: cls.assumption,
      conditionsMode: cond.mode,
      factors,
      benefits,
      tradeoffs,
      limitations,
      warnings,
    },
    raw,
    knownCount,
    conditionsUsed: factors.find((f) => f.key === 'conditions')?.used ?? UNKNOWN_FACTOR_VALUE,
    travelMinutes: c.travel?.mode === 'drive' ? c.travel.winterMinutes : null,
  }
}

function evidenceLimitation(e: CandidateEvidence, date: string, now: string): string | null {
  if (!e.reportAt && !e.reportDate) return 'No snow report on file — conditions rely on the weather model'
  const ref = e.reportAt
  if (ref) {
    const h = hoursBetween(ref, now)
    if (h >= REPORT_AGE_NOTE_H) return `Snow report ${ageLabel(h)} old`
  } else if (e.reportDate && e.reportDate < date) {
    return `Latest snow report is from ${fmt(e.reportDate)} (publish time unknown)`
  }
  return null
}

function weatherLimitation(e: CandidateEvidence, now: string): string | null {
  if (!e.weatherFetchedAt) return 'Weather not fetched yet'
  const h = hoursBetween(e.weatherFetchedAt, now)
  return h >= WEATHER_AGE_NOTE_H ? `Weather data ${ageLabel(h)} old` : null
}

/** Deterministic comparator: total, known factors, conditions, travel time, date, resort id. */
function compareScored(a: Scored, b: Scored): number {
  return (
    b.raw - a.raw ||
    b.knownCount - a.knownCount ||
    b.conditionsUsed - a.conditionsUsed ||
    (a.travelMinutes ?? Number.MAX_SAFE_INTEGER) - (b.travelMinutes ?? Number.MAX_SAFE_INTEGER) ||
    (a.option.date < b.option.date ? -1 : a.option.date > b.option.date ? 1 : 0) ||
    (a.option.resortId < b.option.resortId ? -1 : a.option.resortId > b.option.resortId ? 1 : 0)
  )
}

// ---------------------------------------------------------------------------

/** The exclusion kind that applies on most dates (ties: the earliest date's kind). */
function dominantKind(kinds: readonly ExcludedResort['kind'][]): ExcludedResort['kind'] {
  const counts = new Map<ExcludedResort['kind'], number>()
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1)
  let best = kinds[0]
  for (const k of kinds) if ((counts.get(k) ?? 0) > (counts.get(best) ?? 0)) best = k
  return best
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Why there is no winner, from what actually excluded the resorts (never a generic "nothing is open"). */
export function describeNoWinner(a: { candidates: number; preseason: boolean; excluded: readonly ExcludedResort[]; statusUnknown: number }): string {
  if (a.candidates === 0) return 'No resorts to compare yet.'
  if (a.preseason) return 'Preseason — no resort has reported opening yet this season. Watch openings instead.'
  const n = (k: ExcludedResort['kind']) => a.excluded.filter((e) => e.kind === k).length
  const closed = n('closed')
  const travel = n('travel')
  const pre = n('preseason')
  const unknown = a.statusUnknown
    ? `${plural(a.statusUnknown, 'resort')} with unknown status ${a.statusUnknown === 1 ? 'is' : 'are'} listed separately — never treated as open.`
    : ''
  const kinds = [closed, travel, pre].filter((x) => x > 0).length
  let main: string
  if (kinds === 0) main = 'No resort is confirmed or expected open on these dates.'
  else if (kinds > 1) {
    const parts = [
      travel ? `${travel} outside your travel limits` : null,
      closed ? `${closed} closed` : null,
      pre ? `${pre} not open yet` : null,
    ].filter(Boolean)
    main = `No resort is open and within your travel limits on these dates (${parts.join(', ')}).`
  } else if (travel) main = `No open resort within your travel limits on these dates (${plural(travel, 'resort')} excluded for travel).`
  else if (closed) main = 'No resort is open on these dates — every candidate has a confirmed closure.'
  else main = 'No resort is open yet on these dates.'
  return unknown ? `${main} ${unknown}` : main
}

export function recommend(input: RecommendInput): Recommendation {
  const { weights, note: weightsNote } = resolveWeights(input)
  const dates = [...new Set(input.dates)].sort()
  const eligible: (Scored & { otherDates: RankedOption['otherDates'] })[] = []
  const unknown: (Scored & { otherDates: RankedOption['otherDates'] })[] = []
  const excluded: ExcludedResort[] = []
  let anyOpened = false

  const candidates = [...input.candidates].sort((a, b) => (a.resortId < b.resortId ? -1 : a.resortId > b.resortId ? 1 : 0))
  for (const c of candidates) {
    if (dates.some((d) => hasOpenedThisSeason(c, d))) anyOpened = true
    const perDate: { date: string; cls: DayClass; scored: Scored | null }[] = dates.map((date) => {
      const day = c.days.find((d) => d.date === date)
      let cls = classifyDay(c, day, date, input.now)
      if ((cls.kind === 'confirmed-open' || cls.kind === 'expected-open') && c.travel?.feasible === false) {
        cls = { kind: 'travel', reason: `Outside your travel limits — ${c.travel.note}` }
      }
      const scored = 'note' in cls ? scoreDay(c, day, date, cls, input, weights) : null
      return { date, cls, scored }
    })
    const open = perDate.filter((p) => p.scored && p.scored.option.eligibility !== 'status-unknown').map((p) => p.scored!)
    const unk = perDate.filter((p) => p.scored && p.scored.option.eligibility === 'status-unknown').map((p) => p.scored!)
    const otherDates = (best: Scored): RankedOption['otherDates'] =>
      perDate
        .filter((p) => p.date !== best.option.date)
        .map((p) =>
          p.scored
            ? { date: p.date, total: p.scored.option.total, eligibility: p.scored.option.eligibility, note: p.scored.option.statusNote }
            : { date: p.date, total: null, eligibility: 'excluded' as const, note: (p.cls as { reason: string }).reason },
        )
    if (open.length) {
      const best = open.sort(compareScored)[0]
      eligible.push({ ...best, otherDates: otherDates(best) })
    } else if (unk.length) {
      const best = unk.sort(compareScored)[0]
      unknown.push({ ...best, otherDates: otherDates(best) })
    } else if (perDate.length) {
      const classes = perDate.map((p) => p.cls as { kind: ExcludedResort['kind']; reason: string })
      const kind = dominantKind(classes.map((x) => x.kind))
      // Lead with a reason of the dominant kind so the kind and the text agree.
      const reasons = [...new Set([...classes.filter((x) => x.kind === kind), ...classes].map((x) => x.reason))]
      excluded.push({
        resortId: c.resortId,
        name: c.name,
        kind,
        reason: reasons.length === 1 ? reasons[0] : `${reasons[0]} (and ${reasons.length - 1} other reason${reasons.length > 2 ? 's' : ''} across the dates)`,
      })
    }
  }

  const rank = (list: (Scored & { otherDates: RankedOption['otherDates'] })[]): RankedOption[] =>
    list.sort(compareScored).map((s, i) => ({ ...s.option, rank: i + 1, otherDates: s.otherDates }))
  const ranked = rank(eligible)
  const statusUnknown = rank(unknown)
  const preseason = candidates.length > 0 && !anyOpened
  const winner = preseason ? null : (ranked[0] ?? null)
  const alternatives = winner ? ranked.slice(1, 1 + MAX_ALTERNATIVES) : []

  const explanation = { benefits: [] as string[], tradeoffs: [] as string[] }
  if (winner) {
    explanation.benefits.push(...winner.benefits)
    const runnerUp = ranked[1]
    if (runnerUp) explanation.benefits.push(`Ranks ${winner.total} vs ${runnerUp.total} for ${runnerUp.name} (${PRESET_LABEL[input.preset]})`)
    explanation.tradeoffs.push(...winner.tradeoffs)
    if (winner.eligibility === 'expected-open') explanation.tradeoffs.push('Operating status for this date is an assumption, not a report')
  }

  excluded.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.name.localeCompare(b.name)))
  return {
    preset: input.preset,
    presetLabel: PRESET_LABEL[input.preset],
    weights,
    dates,
    winner,
    alternatives,
    ranked,
    excluded,
    statusUnknown,
    explanation,
    evidenceLimitations: winner ? winner.limitations : [],
    preseason,
    noWinnerReason: winner ? null : describeNoWinner({ candidates: candidates.length, preseason, excluded, statusUnknown: statusUnknown.length }),
    weightsNote,
  }
}
