/** Small formatting helpers for explanation strings (display units applied here only). */
import { formatInstant, localDateOf } from '../time'
import { formatPrecip, formatSnow, formatSpeed, formatTemp, formatVisibility } from '../units'
import type { UnitPrefs } from '../types'

/** "07:10" when the instant falls on `refDate` (resort-local), else "Tue 07:10". */
export function localTimeLabel(instant: string, tz: string, refDate: string): string {
  return localDateOf(instant, tz) === refDate ? formatInstant(instant, tz, 'HH:mm') : formatInstant(instant, tz, 'ccc HH:mm')
}

/** "3 h" below two days, else "2 d". */
export function ageLabel(hours: number): string {
  if (hours < 1) return '<1 h'
  if (hours < 48) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} d`
}

export const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

export function makeFormatters(u: UnitPrefs) {
  return {
    snow: (cm: number) => formatSnow(cm, u) ?? 'unknown',
    rain: (mm: number) => formatPrecip(mm, u) ?? 'unknown',
    temp: (c: number) => formatTemp(c, u) ?? 'unknown',
    speed: (kmh: number) => formatSpeed(kmh, u) ?? 'unknown',
    visibility: (m: number) => formatVisibility(m, u) ?? 'unknown',
  }
}
export type Formatters = ReturnType<typeof makeFormatters>
