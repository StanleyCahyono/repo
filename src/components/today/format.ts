/**
 * Small display helpers for Today — pure and client-safe. Stored values are metric; conversion happens only here,
 * through src/lib/domain/units.ts. Unknown stays null (callers render <Missing/>), a known zero stays "0".
 */
import { formatLocalDate } from '@/lib/domain/time'
import type { OpeningLabel, UnitPrefs } from '@/lib/domain/types'
import { formatSnow, tempValue } from '@/lib/domain/units'

/** "in 47 days" · "tomorrow" · "today" · "yesterday" · "6 days ago". */
export function countdown(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** Larger of base/summit modeled snowfall; null when neither is known. */
export function maxSnow(s: { base: number | null; summit: number | null }): number | null {
  const v = [s.base, s.summit].filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? Math.max(...v) : null
}

/** "1.1″", "≥ 1.1″" for a partial day (a lower bound), null for unknown. */
export function snowLabel(cm: number | null | undefined, units: UnitPrefs, partial = false): string | null {
  const s = formatSnow(cm ?? null, units)
  if (s === null) return null
  return partial ? `≥ ${s}` : s
}

/** "27° / 13°" (high / low, no unit letter — say the unit once nearby). */
export function tempPair(minC: number | null | undefined, maxC: number | null | undefined, units: UnitPrefs): string | null {
  const hi = tempValue(maxC ?? null, units)
  const lo = tempValue(minC ?? null, units)
  if (hi === null && lo === null) return null
  return `${hi ?? '–'}° / ${lo ?? '–'}°`
}

/** Opening date text for the timeline: "Sat 21 Nov", "28 Nov – 5 Dec", or null when not announced. */
export function openingDates(label: OpeningLabel, date: string | null, to: string | null): string | null {
  if (!date || label === 'not-announced') return null
  if (label === 'estimated') return to && to !== date ? `${formatLocalDate(date, 'd LLL')} – ${formatLocalDate(to, 'd LLL')}` : formatLocalDate(date, 'd LLL')
  return formatLocalDate(date)
}

export const OPENING_WORD: Record<OpeningLabel, string> = {
  announced: 'Announced',
  estimated: 'Piste estimate',
  opened: 'Opened',
  'not-announced': 'Not announced',
}

/** Title-case the first letter only ("likely 5″ …" → "Likely 5″ …"). */
export const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Plural helper: plural(2, 'resort') → "2 resorts". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
