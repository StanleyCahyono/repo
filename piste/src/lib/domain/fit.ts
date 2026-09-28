/**
 * "Fit for me" — a personal match (0–100 + reasons), deliberately separate from the date-specific conditions
 * score. It answers "does this resort suit me (and my companion), my travel limits and my budget?".
 *
 * Components (weights depend on ability; companion only when one is set):
 *   terrain   — ability vs the resort's terrain mix (a beginner is NOT a better fit at an expert-only mountain)
 *   learning  — lessons, beginner area, rentals (beginner / novice only)
 *   travel    — drive time with an explicit winter buffer vs `maxDriveHours`, or flying when willing
 *   budget    — per-person day basket vs the day budget (or the expense tier when no budget is set)
 *   companion — terrain for an optional companion: a trip where both have suitable terrain scores higher
 *
 * Honesty rules
 * - Unknown inputs are never assumed favourable: an unknown component counts at UNKNOWN_COMPONENT_VALUE (below
 *   neutral) in the ranking value, is listed in `unknowns`, and lowers `coverage` and `confidence`.
 * - With too little known (coverage < MIN_COVERAGE_FOR_SCORE) there is no displayed score, only `rankValue`.
 * - A poor terrain match caps the whole fit: good travel or a cheap basket cannot make up for having nowhere
 *   suitable to ski.
 *
 * Pure: no clock, DB or network. Thresholds are initial planning heuristics (not calibrated).
 */
import { evalCurve } from './conditions/curve'
import type { Curve } from './conditions/types'
import { formatMoney, type Money } from './money'
import type { AbilityLevel, Confidence, ExpenseTier, VerificationLevel } from './types'
import { formatDuration } from './units'

export type FitComponentKey = 'terrain' | 'learning' | 'travel' | 'budget' | 'companion'

export const FIT_COMPONENT_LABEL: Record<FitComponentKey, string> = {
  terrain: 'Terrain for your level',
  learning: 'Learning support',
  travel: 'Travel from home',
  budget: 'Day cost vs budget',
  companion: 'Terrain for your companion',
}

/** Unknown components count at this value — below neutral, so missing facts never help a resort rank. */
export const UNKNOWN_COMPONENT_VALUE = 40
/** Below this share of known weight there is no displayed fit score. */
export const MIN_COVERAGE_FOR_SCORE = 0.4
/** A terrain value below this caps the overall fit at TERRAIN_MISMATCH_CAP. */
export const TERRAIN_MISMATCH_BELOW = 40
export const TERRAIN_MISMATCH_CAP = 55
/** Flying is feasible but a much bigger commitment than a drive (door-to-door time is not estimated here). */
export const FLY_TRAVEL_VALUE = 35

const ABILITY_LABEL: Record<AbilityLevel, string> = {
  beginner: 'beginner',
  novice: 'novice',
  intermediate: 'intermediate',
  advanced: 'advanced',
  expert: 'expert',
}

export interface FitTerrainInput {
  beginnerPct: number | null
  intermediatePct: number | null
  advancedPct: number | null
  /** Verification of the terrain facts (catalog research is 'search-summary'). */
  verification?: VerificationLevel | null
}

/** `null` = unknown, `false` = confirmed not offered. */
export interface FitLearningInput {
  lessons: boolean | null
  rentals: boolean | null
  beginnerArea: string | null
  learningNotes: string | null
}

export interface FitTravelInput {
  /** One-way drive from home in minutes (curated or routed); null = no drive estimate. */
  driveMinutes: number | null
  /** True for curated estimates (not live routing). */
  driveIsEstimate: boolean
  /** Practical/closest airports recorded for the resort (IATA). */
  airports: readonly string[]
  /** Airport → resort transfer minutes for the most practical airport, when known. */
  transferMinutes?: number | null
}

export interface FitTravelPrefs {
  maxDriveHours: number | null
  willingToFly: boolean
  /** Explicit winter planning buffer added to drive times, in percent. */
  winterBufferPct: number
}

export interface FitCostInput {
  /** Per-person day basket total in the display currency; null when incomplete. */
  total: Money | null
  tier: ExpenseTier | 'incomplete' | null
}

export interface FitInput {
  ability: AbilityLevel
  companion?: { name?: string | null; ability: AbilityLevel | null } | null
  terrain: FitTerrainInput | null
  learning: FitLearningInput | null
  travel: FitTravelInput | null
  travelPrefs: FitTravelPrefs
  cost: FitCostInput | null
  /** Per-person day budget; null = not set. */
  dayBudget: Money | null
  /** Whether the basket includes a rental (own gear makes rental availability irrelevant). */
  needsRental?: boolean
}

export interface FitComponent {
  key: FitComponentKey
  label: string
  /** 0–100, or null when unknown. */
  value: number | null
  weight: number
  /** Value used in the ranking (UNKNOWN_COMPONENT_VALUE when unknown). */
  used: number
  known: boolean
  note: string
}

export interface TravelVerdict {
  mode: 'drive' | 'fly' | 'none'
  /** true = within your limits, false = outside them, null = unknown. */
  feasible: boolean | null
  /** Drive minutes including the winter buffer; null when not driving or unknown. */
  winterMinutes: number | null
  driveMinutes: number | null
  isEstimate: boolean
  note: string
}

export type FitLabel = 'Great fit' | 'Good fit' | 'Mixed fit' | 'Poor fit' | 'Not enough information'

export interface FitResult {
  /** Displayed fit 0–100; null when too little is known. */
  score: number | null
  /** Always a number: the conservative value used for ranking (unknowns counted below neutral). */
  rankValue: number
  label: FitLabel
  confidence: Confidence
  confidenceReasons: string[]
  /** Share of applicable weight with known inputs (0–1). */
  coverage: number
  components: FitComponent[]
  /** Plain-language reasons, strongest first (positives and negatives). */
  reasons: string[]
  /** What is unknown and therefore not counted in the resort's favour. */
  unknowns: string[]
  travel: TravelVerdict
  /** Set when a poor terrain match capped the score. */
  cappedBy: string | null
}

// ---------------------------------------------------------------------------
// Curves (initial planning heuristics)

const TERRAIN_CURVES: Record<AbilityLevel, Curve> = {
  // Share of beginner terrain.
  beginner: [
    [0, 0],
    [5, 15],
    [10, 35],
    [20, 65],
    [30, 85],
    [40, 100],
  ],
  // Beginner + half of intermediate.
  novice: [
    [0, 0],
    [10, 30],
    [25, 65],
    [40, 85],
    [55, 100],
  ],
  // Intermediate share.
  intermediate: [
    [0, 0],
    [15, 35],
    [30, 70],
    [45, 90],
    [55, 100],
  ],
  // Advanced + 30% of intermediate.
  advanced: [
    [0, 0],
    [10, 30],
    [20, 60],
    [35, 85],
    [50, 100],
  ],
  // Advanced share.
  expert: [
    [0, 0],
    [10, 25],
    [25, 60],
    [40, 85],
    [55, 100],
  ],
}

/** Winter drive minutes → value when no drive limit is set. */
const DRIVE_ABSOLUTE: Curve = [
  [0, 100],
  [60, 95],
  [120, 85],
  [240, 65],
  [360, 40],
  [480, 20],
  [720, 5],
]
/** Winter drive ÷ limit → value when within the limit. */
const DRIVE_WITHIN_LIMIT: Curve = [
  [0, 100],
  [0.5, 95],
  [0.75, 85],
  [1, 70],
]
/** Basket ÷ day budget → value. */
const BUDGET_RATIO: Curve = [
  [0, 100],
  [0.6, 95],
  [0.8, 85],
  [1, 70],
  [1.2, 40],
  [1.5, 15],
  [2, 0],
]
const TIER_VALUE: Record<ExpenseTier, number> = { $: 90, $$: 70, $$$: 45, $$$$: 20 }

function weightsFor(ability: AbilityLevel, hasCompanion: boolean): Record<FitComponentKey, number> {
  const learningLevel = ability === 'beginner' || ability === 'novice'
  const base: Record<FitComponentKey, number> = learningLevel
    ? { terrain: 30, learning: 20, travel: 25, budget: 15, companion: 0 }
    : ability === 'intermediate'
      ? { terrain: 35, learning: 0, travel: 30, budget: 20, companion: 0 }
      : { terrain: 40, learning: 0, travel: 30, budget: 20, companion: 0 }
  if (hasCompanion) base.companion = 15
  return base
}

const isPct = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const round = (v: number) => Math.round(v)
const researchGrade = (v: VerificationLevel | null | undefined) => v == null || v === 'search-summary' || v === 'unverified'

// ---------------------------------------------------------------------------
// Terrain

export interface TerrainMatch {
  value: number | null
  /** Terrain share used, in percent. */
  share: number | null
  note: string
  /** The terrain split is research-grade (confirm at source). */
  researched: boolean
}

/** How well a terrain mix suits one ability level. Pure and reusable (companion, explore filters). */
export function terrainMatch(ability: AbilityLevel, t: FitTerrainInput | null): TerrainMatch {
  const b = isPct(t?.beginnerPct) ? t!.beginnerPct! : null
  const i = isPct(t?.intermediatePct) ? t!.intermediatePct! : null
  const a = isPct(t?.advancedPct) ? t!.advancedPct! : null
  const lvl = ABILITY_LABEL[ability]
  let share: number | null = null
  let what = ''
  switch (ability) {
    case 'beginner':
      share = b
      what = 'beginner terrain'
      break
    case 'novice':
      share = b === null ? null : b + (i ?? 0) * 0.5
      what = i === null ? 'beginner terrain (intermediate share unknown)' : 'beginner and easier intermediate terrain'
      break
    case 'intermediate':
      share = i
      what = 'intermediate terrain'
      break
    case 'advanced':
      share = a === null ? null : a + (i ?? 0) * 0.3
      what = i === null ? 'advanced terrain' : 'advanced and upper intermediate terrain'
      break
    case 'expert':
      share = a
      what = 'advanced/expert terrain'
      break
  }
  const researched = researchGrade(t?.verification)
  if (share === null) {
    return { value: null, share: null, note: `Terrain mix for a ${lvl} is unknown`, researched }
  }
  let value = round(evalCurve(TERRAIN_CURVES[ability], share))
  let note = `${round(share)}% ${what}`
  // An expert-dominated mountain is not a learning mountain, however the numbers interpolate.
  if ((ability === 'beginner' || ability === 'novice') && a !== null && a >= 50 && (b ?? 0) <= 15) {
    value = Math.min(value, 30)
    note += ` — mostly advanced/expert terrain (${round(a)}%)`
  }
  // Conversely an almost all-beginner hill offers little for strong skiers.
  if ((ability === 'advanced' || ability === 'expert') && b !== null && b >= 50 && (a ?? 0) <= 10) {
    value = Math.min(value, 30)
    note += ` — mostly beginner terrain (${round(b)}%)`
  }
  return { value, share, note, researched }
}

// ---------------------------------------------------------------------------
// Travel

export function travelVerdict(t: FitTravelInput | null, prefs: FitTravelPrefs): TravelVerdict {
  const buffer = Math.max(0, prefs.winterBufferPct)
  const maxMin = prefs.maxDriveHours != null && prefs.maxDriveHours > 0 ? prefs.maxDriveHours * 60 : null
  const airports = t?.airports ?? []
  const via = airports.length ? ` via ${airports.slice(0, 2).join('/')}` : ''
  const fly = (why: string): TravelVerdict => ({
    mode: 'fly',
    feasible: true,
    winterMinutes: null,
    driveMinutes: t?.driveMinutes ?? null,
    isEstimate: true,
    note: `${why}Fly${via} — door-to-door time not estimated`,
  })

  if (t && t.driveMinutes != null && t.driveMinutes >= 0) {
    const winter = round(t.driveMinutes * (1 + buffer / 100))
    const est = t.driveIsEstimate ? 'about ' : ''
    const drive = `${est}${formatDuration(t.driveMinutes)} drive (${formatDuration(winter)} with a ${buffer}% winter buffer)`
    if (maxMin === null) {
      return { mode: 'drive', feasible: true, winterMinutes: winter, driveMinutes: t.driveMinutes, isEstimate: t.driveIsEstimate, note: `${capitalise(drive)}; no drive limit set` }
    }
    if (winter <= maxMin) {
      return {
        mode: 'drive',
        feasible: true,
        winterMinutes: winter,
        driveMinutes: t.driveMinutes,
        isEstimate: t.driveIsEstimate,
        note: `${capitalise(drive)}, within your ${formatDuration(maxMin)} limit`,
      }
    }
    if (prefs.willingToFly && airports.length) return fly(`${capitalise(drive)} exceeds your ${formatDuration(maxMin)} limit. `)
    return {
      mode: 'drive',
      feasible: false,
      winterMinutes: winter,
      driveMinutes: t.driveMinutes,
      isEstimate: t.driveIsEstimate,
      note: `${capitalise(drive)} exceeds your ${formatDuration(maxMin)} limit${prefs.willingToFly ? ' and no airport is recorded' : ' and you prefer not to fly'}`,
    }
  }
  if (airports.length) {
    if (prefs.willingToFly) return fly('')
    return { mode: 'fly', feasible: false, winterMinutes: null, driveMinutes: null, isEstimate: true, note: `Fly-in destination${via}; you prefer not to fly` }
  }
  return { mode: 'none', feasible: null, winterMinutes: null, driveMinutes: null, isEstimate: true, note: 'No drive or airport information recorded' }
}

function travelValue(v: TravelVerdict, prefs: FitTravelPrefs, transferMinutes: number | null | undefined): number | null {
  if (v.feasible === null) return null
  if (v.feasible === false) return 0
  if (v.mode === 'fly') return transferMinutes != null && transferMinutes > 180 ? FLY_TRAVEL_VALUE - 10 : FLY_TRAVEL_VALUE
  const maxMin = prefs.maxDriveHours != null && prefs.maxDriveHours > 0 ? prefs.maxDriveHours * 60 : null
  if (v.winterMinutes === null) return null
  return round(maxMin === null ? evalCurve(DRIVE_ABSOLUTE, v.winterMinutes) : evalCurve(DRIVE_WITHIN_LIMIT, v.winterMinutes / maxMin))
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// ---------------------------------------------------------------------------

export function computeFit(input: FitInput): FitResult {
  const companionAbility = input.companion?.ability ?? null
  const hasCompanion = companionAbility !== null
  const w = weightsFor(input.ability, hasCompanion)
  const lvl = ABILITY_LABEL[input.ability]
  const components: FitComponent[] = []
  const push = (key: FitComponentKey, value: number | null, note: string) => {
    if (w[key] <= 0) return
    const v = value === null ? null : Math.max(0, Math.min(100, round(value)))
    components.push({
      key,
      label: FIT_COMPONENT_LABEL[key],
      value: v,
      weight: w[key],
      used: v ?? UNKNOWN_COMPONENT_VALUE,
      known: v !== null,
      note: v === null ? `${note} — not counted in the resort's favour` : note,
    })
  }

  // Terrain
  const terrain = terrainMatch(input.ability, input.terrain)
  push(
    'terrain',
    terrain.value,
    terrain.value === null
      ? terrain.note
      : `${capitalise(terrain.note)} for a ${lvl}${terrain.researched ? ' (researched split — confirm at source)' : ''}`,
  )

  // Learning support
  if (w.learning > 0) {
    const l = input.learning
    const needsRental = input.needsRental ?? true
    const known = l && (l.lessons !== null || l.beginnerArea || (needsRental && l.rentals !== null))
    if (!l || !known) {
      push('learning', null, 'Lessons, rentals and beginner area are not recorded')
    } else {
      let v = 50
      const parts: string[] = []
      if (l.lessons === true) {
        v += 25
        parts.push('lessons offered')
      } else if (l.lessons === false) {
        v -= 35
        parts.push('no lessons offered')
      } else parts.push('lessons unknown')
      if (l.beginnerArea) {
        v += 15
        parts.push('dedicated beginner area')
      }
      if (needsRental) {
        if (l.rentals === true) {
          v += 10
          parts.push('rentals on site')
        } else if (l.rentals === false) {
          v -= 10
          parts.push('no rentals on site')
        } else parts.push('rentals unknown')
      }
      push('learning', v, capitalise(parts.join(', ')))
    }
  }

  // Travel
  const travel = travelVerdict(input.travel, input.travelPrefs)
  push('travel', travelValue(travel, input.travelPrefs, input.travel?.transferMinutes), travel.note)

  // Budget
  const cost = input.cost
  if (!cost || (cost.total === null && (cost.tier === null || cost.tier === 'incomplete'))) {
    push('budget', null, 'Cost estimate incomplete')
  } else if (input.dayBudget && cost.total && cost.total.currency === input.dayBudget.currency && input.dayBudget.amountMinor > 0) {
    const ratio = cost.total.amountMinor / input.dayBudget.amountMinor
    const within = ratio <= 1 ? 'within' : 'over'
    push('budget', evalCurve(BUDGET_RATIO, ratio), `${formatMoney(cost.total)} per person per day, ${within} your ${formatMoney(input.dayBudget)} day budget`)
  } else if (cost.tier && cost.tier !== 'incomplete') {
    const why = input.dayBudget ? 'budget in another currency' : 'no day budget set'
    push('budget', TIER_VALUE[cost.tier], `Expense tier ${cost.tier}${cost.total ? ` (${formatMoney(cost.total)} per person)` : ''}; ${why}`)
  } else {
    push('budget', null, 'Cost estimate incomplete')
  }

  // Companion
  if (hasCompanion) {
    const who = input.companion?.name ? `${input.companion.name} (${ABILITY_LABEL[companionAbility!]})` : `your ${ABILITY_LABEL[companionAbility!]} companion`
    const c = terrainMatch(companionAbility!, input.terrain)
    if (c.value === null) push('companion', null, `Terrain for ${who} is unknown`)
    else {
      const both = terrain.value !== null && terrain.value >= 65 && c.value >= 65
      const note = both
        ? `Suitable terrain for both you and ${who}: ${c.note}`
        : c.value < 45
          ? `Limited terrain for ${who}: ${c.note}`
          : `Terrain for ${who}: ${c.note}`
      push('companion', c.value, note)
    }
  }

  // Combine
  const total = components.reduce((a, c) => a + c.weight, 0)
  const knownW = components.filter((c) => c.known).reduce((a, c) => a + c.weight, 0)
  const coverage = total > 0 ? Math.round((knownW / total) * 1000) / 1000 : 0
  const raw = total > 0 ? components.reduce((a, c) => a + c.weight * c.used, 0) / total : UNKNOWN_COMPONENT_VALUE
  let cappedBy: string | null = null
  let capped = raw
  if (terrain.value !== null && terrain.value < TERRAIN_MISMATCH_BELOW && raw > TERRAIN_MISMATCH_CAP) {
    capped = TERRAIN_MISMATCH_CAP
    cappedBy = `Little terrain suits a ${lvl} here, so fit is capped at ${TERRAIN_MISMATCH_CAP} however good the travel or price`
  }
  const rankValue = round(capped)
  const score = coverage >= MIN_COVERAGE_FOR_SCORE ? rankValue : null

  // Confidence
  const confidenceReasons: string[] = []
  let level = 0
  if (coverage < 0.6) {
    level = 2
    confidenceReasons.push(`Only ${round(coverage * 100)}% of the fit inputs are known`)
  } else if (coverage < 0.9) {
    level = 1
    confidenceReasons.push(`${round(coverage * 100)}% of the fit inputs are known`)
  }
  if (terrain.value !== null && researchGrade(input.terrain?.verification)) {
    level = Math.max(level, 1)
    confidenceReasons.push('Terrain split is researched catalog data — confirm at source')
  }
  if (travel.mode === 'drive' && travel.isEstimate) {
    level = Math.max(level, 1)
    confidenceReasons.push('Drive time is a curated estimate, not live routing')
  }
  const confidence: Confidence = level >= 2 ? 'low' : level === 1 ? 'medium' : 'high'

  // Reasons: cap first, then components by weighted distance from neutral.
  const reasons: string[] = []
  if (cappedBy) reasons.push(cappedBy)
  const ranked = components
    .filter((c) => c.known)
    .sort((a, b) => b.weight * Math.abs(b.used - 50) - a.weight * Math.abs(a.used - 50) || a.key.localeCompare(b.key))
  for (const c of ranked) reasons.push(c.note)
  const unknowns = components.filter((c) => !c.known).map((c) => c.note)

  const label: FitLabel =
    score === null ? 'Not enough information' : score >= 80 ? 'Great fit' : score >= 65 ? 'Good fit' : score >= 50 ? 'Mixed fit' : 'Poor fit'

  return { score, rankValue, label, confidence, confidenceReasons, coverage, components, reasons, unknowns, travel, cappedBy }
}
