/**
 * How each in-app alert type is described and edited. Pure constants; the parameter ranges and defaults mirror
 * RULE_PARAMS in src/lib/jobs/alerts.ts (checked by alert-specs.test.ts), which stays the source of truth — the
 * server action validates against it.
 */
import type { AlertType } from '@/lib/db/schema'
import { SCORING_MODES, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import { cmToIn, formatSnow, inToCm } from '@/lib/domain/units'
import { SCORING_TEXT } from './options'

export type ParamKind = 'days' | 'hours' | 'snow' | 'points'

export interface ParamSpec {
  key: string
  label: string
  kind: ParamKind
  /** Stored units: days, hours, cm, score points. */
  min: number
  max: number
  default: number
  hint?: string
}

export interface AlertSpec {
  title: string
  /** What it watches, in one line. */
  summary: string
  /** Honest caveat shown in the editor. */
  caveat?: string
  params: ParamSpec[]
  /** Offers a conditions-lens choice (forecast deterioration). */
  mode?: boolean
  /** Text for a rule without a resort. */
  allScope: string
  /** false = the rule always covers everything (no resort choice). */
  resortScope: boolean
}

export const ALERT_SPECS: Record<AlertType, AlertSpec> = {
  'opening-date-change': {
    title: 'Opening or closing date changes',
    summary: 'An announced opening or closing date is set, moved or removed.',
    caveat: 'An announced date is a target: it never turns into “Open” by itself.',
    params: [{ key: 'lookbackDays', label: 'Report changes from the last', kind: 'days', min: 1, max: 60, default: 14 }],
    allScope: 'All favourites',
    resortScope: true,
  },
  'resort-opened': {
    title: 'Resort opened for the season',
    summary: 'An opening is confirmed (from an official report or your own entry).',
    params: [{ key: 'lookbackDays', label: 'Report openings from the last', kind: 'days', min: 1, max: 60, default: 14 }],
    allScope: 'All favourites',
    resortScope: true,
  },
  'pass-deadline': {
    title: 'Pass sales deadline',
    summary: 'A pass product’s published sales deadline is getting close.',
    caveat: 'Watches the sales deadlines on file for each pass product.',
    params: [{ key: 'withinDays', label: 'Warn when the deadline is within', kind: 'days', min: 1, max: 60, default: 14 }],
    allScope: 'Every pass product with a deadline',
    resortScope: false,
  },
  'snow-threshold': {
    title: 'Forecast snow',
    summary: 'Modeled snowfall at the upper mountain passes your threshold.',
    caveat: 'Weather-model output, not an observation — only a forecast fetched in the last day can raise it.',
    params: [
      { key: 'thresholdCm', label: 'At least', kind: 'snow', min: 1, max: 300, default: 15 },
      { key: 'windowHours', label: 'Within the next', kind: 'hours', min: 6, max: 168, default: 72 },
    ],
    allScope: 'All favourites',
    resortScope: true,
  },
  'forecast-deterioration': {
    title: 'Outlook drops for a planned day',
    summary: 'The conditions score for a ski day in a draft or booked trip falls, or a closure is confirmed.',
    caveat: 'Scores describe suitability, not safety.',
    params: [{ key: 'minDrop', label: 'When it falls by at least', kind: 'points', min: 1, max: 100, default: 15 }],
    mode: true,
    allScope: 'All planned trips',
    resortScope: true,
  },
  event: {
    title: 'New or changed events',
    summary: 'An event is added or its date, venue, tickets or price change.',
    params: [],
    allScope: 'Favourites and resorts in your trips',
    resortScope: true,
  },
  'price-change': {
    title: 'Verified price changes',
    summary: 'A price confirmed at an official source (or by you) changes for the same product and day type.',
    caveat: 'Only prices from an official source or entered by you raise this alert; estimates never do.',
    params: [{ key: 'lookbackDays', label: 'Report changes from the last', kind: 'days', min: 1, max: 365, default: 30 }],
    allScope: 'All resorts',
    resortScope: true,
  },
}

export const ALERT_TYPE_ORDER: AlertType[] = ['snow-threshold', 'opening-date-change', 'resort-opened', 'forecast-deterioration', 'pass-deadline', 'event', 'price-change']

/** Types whose rules never take a resort. */
export const GLOBAL_ONLY_ALERTS: readonly AlertType[] = (Object.keys(ALERT_SPECS) as AlertType[]).filter((t) => !ALERT_SPECS[t].resortScope)

export function paramValue(params: Record<string, unknown>, spec: ParamSpec): number {
  const v = params[spec.key]
  return typeof v === 'number' && Number.isFinite(v) ? v : spec.default
}

export function modeValue(params: Record<string, unknown>): ScoringMode | null {
  const m = params.mode
  return typeof m === 'string' && (SCORING_MODES as readonly string[]).includes(m) ? (m as ScoringMode) : null
}

/** Snow thresholds are stored in cm and typed in the display unit. */
export function snowToInput(cm: number, units: UnitPrefs): number {
  return units.snow === 'in' ? Math.round(cmToIn(cm) * 10) / 10 : Math.round(cm * 10) / 10
}

export function snowFromInput(v: number, units: UnitPrefs): number {
  return Math.round((units.snow === 'in' ? inToCm(v) : v) * 10) / 10
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function describeParam(spec: ParamSpec, value: number, units: UnitPrefs): string {
  switch (spec.kind) {
    case 'days':
      return plural(value, 'day')
    case 'hours':
      return `${value} h`
    case 'snow':
      return formatSnow(value, units) ?? `${value} cm`
    case 'points':
      return plural(value, 'point')
  }
}

/** One plain sentence for a rule, in the viewer's units. */
export function describeRule(type: AlertType, params: Record<string, unknown>, units: UnitPrefs): string {
  const spec = ALERT_SPECS[type]
  const v = (key: string) => {
    const p = spec.params.find((x) => x.key === key)!
    return describeParam(p, paramValue(params, p), units)
  }
  switch (type) {
    case 'opening-date-change':
      return `Changes announced in the last ${v('lookbackDays')}`
    case 'resort-opened':
      return `Openings confirmed in the last ${v('lookbackDays')}`
    case 'pass-deadline':
      return `Deadlines within ${v('withinDays')}`
    case 'snow-threshold':
      return `Likely ${v('thresholdCm')} or more within ${v('windowHours')}`
    case 'forecast-deterioration': {
      const m = modeValue(params)
      return `Score falls ${v('minDrop')} or more · ${m ? SCORING_TEXT[m].label : 'your default lens'}`
    }
    case 'event':
      return 'Any new or changed event'
    case 'price-change':
      return `Changes observed in the last ${v('lookbackDays')}`
  }
}
