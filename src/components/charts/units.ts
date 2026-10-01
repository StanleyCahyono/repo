/**
 * Display-unit adapters for charts, built on src/lib/domain/units.ts and the user's unit preferences.
 *
 * Stored values are canonical metric (cm snow, mm rain, °C, km/h, m). A chart converts to display units only to
 * plot (`toDisplay`, unrounded so shapes stay exact) and to label (`format`, rounded like the rest of the app).
 * Unknown stays unknown: every function maps null/undefined to null — never to 0.
 */
import { cToF, cmToIn, formatElevation, formatSnow, formatSpeed, formatTemp, kmToMi, kmhToMph, mToFt, mmToIn } from '@/lib/domain/units'
import type { UnitPrefs } from '@/lib/domain/types'

export type QuantityKey = 'snow' | 'precip' | 'temp' | 'speed' | 'elevation' | 'visibility'

export interface Quantity {
  key: QuantityKey
  /** Unit label for axes, headers and table columns: 'in', 'cm', '°F', 'mph', 'ft', 'mi'… */
  unit: string
  /** Canonical metric → display units, unrounded (for plotting). */
  toDisplay(v: number | null | undefined): number | null
  /** Rounded display string with its unit ('4.2″', '−6°F', '18 mph'); null for unknown. */
  format(v: number | null | undefined): string | null
  /** Rounded number without the unit, for dense tables and cells ('4.2', '−6'); null for unknown. */
  short(v: number | null | undefined): string | null
  /** Axis tick label for a value already in display units. */
  tick(v: number): string
  /** Readable minimum top for a zero-based axis, in display units. */
  floorMax: number
  /** Display cap (visibility: values beyond it read "16+ km"). */
  cap?: number
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Typographic minus for negative numbers ('−6' rather than '-6'). */
export function minus(s: string): string {
  return s.replace(/^-(?=\d)/, '−').replace(/(\s)-(?=\d)/g, '$1−')
}

function trim(v: number, digits: number): string {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return minus(r.toLocaleString('en-US', { maximumFractionDigits: digits }))
}

/** Axis ticks: integers without decimals, small steps with up to 2. */
function tickText(v: number): string {
  const abs = Math.abs(v)
  return trim(v, abs >= 100 || Number.isInteger(v) ? 0 : abs >= 10 ? 1 : 2)
}

export function chartUnits(u: UnitPrefs): Record<QuantityKey, Quantity> {
  const inches = u.snow === 'in'
  const fahrenheit = u.temperature === 'F'
  const mph = u.speed === 'mph'
  const feet = u.elevation === 'ft'
  const miles = u.distance === 'mi'

  const snow: Quantity = {
    key: 'snow',
    unit: inches ? 'in' : 'cm',
    toDisplay: (v) => (isNum(v) ? (inches ? cmToIn(v) : v) : null),
    format: (v) => {
      if (isNum(v) && v > 0 && (inches ? cmToIn(v) : v) < 0.05) return inches ? '<0.1″' : '<0.1 cm'
      const s = formatSnow(v, u)
      return s === null ? null : minus(s)
    },
    short: (v) => {
      if (!isNum(v)) return null
      const d = inches ? cmToIn(v) : v
      if (v > 0 && d < 0.05) return '<0.1'
      return trim(d, d < 10 ? 1 : 0)
    },
    tick: tickText,
    floorMax: inches ? 0.4 : 1,
  }
  const precip: Quantity = {
    key: 'precip',
    unit: inches ? 'in' : 'mm',
    toDisplay: (v) => (isNum(v) ? (inches ? mmToIn(v) : v) : null),
    format: (v) => {
      if (!isNum(v)) return null
      if (v > 0 && (inches ? mmToIn(v) < 0.005 : v < 0.05)) return inches ? '<0.01 in' : '<0.1 mm'
      return inches ? `${trim(mmToIn(v), 2)} in` : `${trim(v, 1)} mm`
    },
    short: (v) => {
      if (!isNum(v)) return null
      if (v > 0 && (inches ? mmToIn(v) < 0.005 : v < 0.05)) return inches ? '<0.01' : '<0.1'
      return inches ? trim(mmToIn(v), 2) : trim(v, 1)
    },
    tick: tickText,
    floorMax: inches ? 0.04 : 1,
  }
  const temp: Quantity = {
    key: 'temp',
    unit: `°${u.temperature}`,
    toDisplay: (v) => (isNum(v) ? (fahrenheit ? cToF(v) : v) : null),
    format: (v) => {
      const s = formatTemp(v, u)
      return s === null ? null : minus(s)
    },
    short: (v) => (isNum(v) ? `${trim(fahrenheit ? cToF(v) : v, 0)}°` : null),
    tick: (v) => `${tickText(v)}°`,
    floorMax: 0,
  }
  const speed: Quantity = {
    key: 'speed',
    unit: mph ? 'mph' : 'km/h',
    toDisplay: (v) => (isNum(v) ? (mph ? kmhToMph(v) : v) : null),
    format: (v) => formatSpeed(v, u),
    short: (v) => (isNum(v) ? trim(mph ? kmhToMph(v) : v, 0) : null),
    tick: tickText,
    floorMax: mph ? 20 : 30,
  }
  const elevation: Quantity = {
    key: 'elevation',
    unit: feet ? 'ft' : 'm',
    toDisplay: (v) => (isNum(v) ? (feet ? mToFt(v) : v) : null),
    format: (v) => formatElevation(v, u),
    short: (v) => (isNum(v) ? trim(feet ? mToFt(v) : v, 0) : null),
    tick: tickText,
    floorMax: 0,
  }
  // Visibility is stored in metres; shown in km or miles and capped where models stop resolving it.
  const visCap = miles ? 10 : 16
  const visibility: Quantity = {
    key: 'visibility',
    unit: miles ? 'mi' : 'km',
    toDisplay: (v) => (isNum(v) ? (miles ? kmToMi(v / 1000) : v / 1000) : null),
    format: (v) => {
      if (!isNum(v)) return null
      const d = miles ? kmToMi(v / 1000) : v / 1000
      return d >= visCap ? `${visCap}+ ${miles ? 'mi' : 'km'}` : `${trim(d, d < 10 ? 1 : 0)} ${miles ? 'mi' : 'km'}`
    },
    short: (v) => {
      if (!isNum(v)) return null
      const d = miles ? kmToMi(v / 1000) : v / 1000
      return d >= visCap ? `${visCap}+` : trim(d, d < 10 ? 1 : 0)
    },
    tick: tickText,
    floorMax: visCap,
    cap: visCap,
  }
  return { snow, precip, temp, speed, elevation, visibility }
}
