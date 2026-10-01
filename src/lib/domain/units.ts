/**
 * Unit conversion and display formatting. Stored values are canonical metric (see types.ts); these helpers are
 * the only place display units are applied. Formatters return `null` for unknown input so the UI can render an
 * explicit missing state instead of "0".
 */
import type { UnitPrefs } from './types'

export const CM_PER_IN = 2.54
export const M_PER_FT = 0.3048
export const KM_PER_MI = 1.609344

export const cmToIn = (cm: number) => cm / CM_PER_IN
export const inToCm = (inch: number) => inch * CM_PER_IN
export const mmToIn = (mm: number) => mm / 25.4
export const cToF = (c: number) => (c * 9) / 5 + 32
export const fToC = (f: number) => ((f - 32) * 5) / 9
export const kmhToMph = (kmh: number) => kmh / KM_PER_MI
export const mphToKmh = (mph: number) => mph * KM_PER_MI
export const mToFt = (m: number) => m / M_PER_FT
export const ftToM = (ft: number) => ft * M_PER_FT
export const kmToMi = (km: number) => km / KM_PER_MI
export const miToKm = (mi: number) => mi * KM_PER_MI

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function round(v: number, digits: number) {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** Snowfall / snow depth. Inches get 1 decimal below 10", whole numbers above. */
export function snowValue(cm: number | null | undefined, u: UnitPrefs): number | null {
  if (!isNum(cm)) return null
  if (u.snow === 'in') {
    const v = cmToIn(cm)
    return v < 10 ? round(v, 1) : Math.round(v)
  }
  return cm < 10 ? round(cm, 1) : Math.round(cm)
}

export function formatSnow(cm: number | null | undefined, u: UnitPrefs): string | null {
  const v = snowValue(cm, u)
  if (v === null) return null
  return u.snow === 'in' ? `${v}″` : `${v} cm`
}

export function formatPrecip(mm: number | null | undefined, u: UnitPrefs): string | null {
  if (!isNum(mm)) return null
  return u.snow === 'in' ? `${round(mmToIn(mm), 2)} in` : `${round(mm, 1)} mm`
}

export function tempValue(c: number | null | undefined, u: UnitPrefs): number | null {
  if (!isNum(c)) return null
  return Math.round(u.temperature === 'F' ? cToF(c) : c)
}

export function formatTemp(c: number | null | undefined, u: UnitPrefs): string | null {
  const v = tempValue(c, u)
  return v === null ? null : `${v}°${u.temperature}`
}

export function speedValue(kmh: number | null | undefined, u: UnitPrefs): number | null {
  if (!isNum(kmh)) return null
  return Math.round(u.speed === 'mph' ? kmhToMph(kmh) : kmh)
}

export function formatSpeed(kmh: number | null | undefined, u: UnitPrefs): string | null {
  const v = speedValue(kmh, u)
  return v === null ? null : `${v} ${u.speed === 'mph' ? 'mph' : 'km/h'}`
}

export function elevationValue(m: number | null | undefined, u: UnitPrefs): number | null {
  if (!isNum(m)) return null
  return Math.round(u.elevation === 'ft' ? mToFt(m) : m)
}

export function formatElevation(m: number | null | undefined, u: UnitPrefs): string | null {
  const v = elevationValue(m, u)
  return v === null ? null : `${v.toLocaleString('en-US')} ${u.elevation}`
}

export function distanceValue(km: number | null | undefined, u: UnitPrefs): number | null {
  if (!isNum(km)) return null
  const v = u.distance === 'mi' ? kmToMi(km) : km
  return v < 10 ? round(v, 1) : Math.round(v)
}

export function formatDistance(km: number | null | undefined, u: UnitPrefs): string | null {
  const v = distanceValue(km, u)
  return v === null ? null : `${v.toLocaleString('en-US')} ${u.distance}`
}

export function formatVisibility(m: number | null | undefined, u: UnitPrefs): string | null {
  if (!isNum(m)) return null
  if (u.distance === 'mi') {
    const mi = kmToMi(m / 1000)
    return mi >= 10 ? '10+ mi' : `${round(mi, 1)} mi`
  }
  const km = m / 1000
  return km >= 16 ? '16+ km' : `${round(km, 1)} km`
}

export function formatDuration(minutes: number | null | undefined): string | null {
  if (!isNum(minutes)) return null
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Unit labels for chart axes. */
export function unitLabel(kind: 'snow' | 'temp' | 'speed' | 'elevation' | 'distance', u: UnitPrefs): string {
  switch (kind) {
    case 'snow':
      return u.snow === 'in' ? 'in' : 'cm'
    case 'temp':
      return `°${u.temperature}`
    case 'speed':
      return u.speed === 'mph' ? 'mph' : 'km/h'
    case 'elevation':
      return u.elevation
    case 'distance':
      return u.distance
  }
}
