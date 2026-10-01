/**
 * Evidence confidence (High / Medium / Low) — a qualitative label from freshness, coverage, lead time, source
 * quality and model disagreement. It is not a probability.
 */
import type { Confidence } from '../types'
import { hoursBetween } from '../time'
import { ageLabel, makeFormatters, pct } from './format'
import type { SurfaceResult } from './surface'
import type { ConditionsConfig } from './types'
import type { UnitPrefs } from '../types'

export interface ConfidenceInput {
  surface: SurfaceResult
  coverage: number
  leadDays: number
  now: string
  /** Oldest retrieval time among the weather points used; null when unknown or no weather. */
  weatherFetchedAt: string | null
  hasWeather: boolean
  /** Primary model's snowfall for the date and an alternate model's, when both genuinely exist. */
  primarySnowfallCm: number | null
  alternate: { label: string; snowfallCm: number | null } | null
  units: UnitPrefs
}

export interface ConfidenceResult {
  confidence: Confidence
  reasons: string[]
  /** Penalty per factor (0 = no concern). */
  factors: Record<'source' | 'weatherFreshness' | 'coverage' | 'leadTime' | 'disagreement', number>
}

export function assessConfidence(i: ConfidenceInput, cfg: ConditionsConfig): ConfidenceResult {
  const c = cfg.confidence
  const f = makeFormatters(i.units)
  const reasons: string[] = []
  const factors: ConfidenceResult['factors'] = { source: 0, weatherFreshness: 0, coverage: 0, leadTime: 0, disagreement: 0 }

  // Source quality: official > personal > modeled.
  switch (i.surface.evidence) {
    case 'official':
      reasons.push(`Surface from an official report${i.surface.reportAgeHours !== null ? ` (${ageLabel(i.surface.reportAgeHours)} old)` : ''}`)
      break
    case 'personal':
      factors.source = 1
      reasons.push('Surface from my own feedback, not an official report')
      break
    case 'modeled':
      factors.source = 2
      reasons.push(
        i.surface.reportState === 'stale' || i.surface.reportState === 'superseded'
          ? 'Surface inferred from modeled weather and an older report'
          : 'Surface inferred from modeled weather only',
      )
      break
    default:
      factors.source = 2
      reasons.push('No surface evidence')
  }
  if (i.surface.reportTimeAssumed) reasons.push('Report publish time not stated; age measured from its date')

  // Weather freshness.
  if (i.hasWeather) {
    if (!i.weatherFetchedAt) {
      factors.weatherFreshness = 1
      reasons.push('Weather retrieval time unknown')
    } else {
      const age = Math.max(0, hoursBetween(i.weatherFetchedAt, i.now))
      if (age > c.weatherStaleHours) {
        factors.weatherFreshness = 1
        reasons.push(`Weather data ${ageLabel(age)} old`)
      }
    }
  }

  // Coverage.
  if (i.coverage < c.coverage.medium) {
    factors.coverage = 2
    reasons.push(`Inputs cover ${pct(i.coverage)} of the weighted model`)
  } else if (i.coverage < c.coverage.high) {
    factors.coverage = 1
    reasons.push(`Inputs cover ${pct(i.coverage)} of the weighted model`)
  }

  // Lead time.
  if (i.leadDays >= c.leadDays.low) {
    factors.leadTime = 2
    reasons.push(`Forecast ${i.leadDays} days ahead`)
  } else if (i.leadDays >= c.leadDays.medium) {
    factors.leadTime = 1
    reasons.push(`Forecast ${i.leadDays} days ahead`)
  }

  // Model disagreement — only when an alternate model genuinely supplied a value.
  if (i.alternate && i.alternate.snowfallCm !== null && i.primarySnowfallCm !== null) {
    const a = i.primarySnowfallCm
    const b = i.alternate.snowfallCm
    const diff = Math.abs(a - b)
    if (diff >= c.disagreement.minAbsCm && diff >= c.disagreement.minRelative * Math.max(a, b)) {
      factors.disagreement = 1
      reasons.push(`Models disagree on snowfall (${f.snow(a)} vs ${f.snow(b)} from ${i.alternate.label})`)
    } else {
      reasons.push(`${i.alternate.label} broadly agrees on snowfall`)
    }
  }

  const values = Object.values(factors)
  const total = values.reduce((a, b) => a + b, 0)
  const confidence: Confidence = values.some((v) => v >= c.lowFactorPenalty) || total >= c.lowTotal ? 'low' : total >= 1 ? 'medium' : 'high'
  return { confidence, reasons, factors }
}
