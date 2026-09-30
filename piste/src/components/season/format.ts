/**
 * Pure helpers for My Season (server- and client-safe): labels, date text, money text and form presets.
 * Presets only fill the form — whatever I type is kept as written.
 */
import { currencyChoicesFor, formatMoney, toMajorString, type Money } from '@/lib/domain/money'
import { formatLocalDate } from '@/lib/domain/time'
import { provenance, type Provenance } from '@/lib/domain/types'
import type { BudgetCategory } from '@/lib/domain/costs'

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Sat 10 Jan" (adds the year when it differs from `ref`). */
export function dayLabel(date: string, ref?: string): string {
  return formatLocalDate(date, ref && ref.slice(0, 4) !== date.slice(0, 4) ? 'ccc d LLL yyyy' : 'ccc d LLL')
}

export const longDay = (date: string) => formatLocalDate(date, 'cccc d LLLL yyyy')

export function rangeLabel(start: string, end: string): string {
  if (start === end) return formatLocalDate(start, 'd LLL')
  return start.slice(0, 7) === end.slice(0, 7) ? `${formatLocalDate(start, 'd')}–${formatLocalDate(end, 'd LLL')}` : `${formatLocalDate(start, 'd LLL')} – ${formatLocalDate(end, 'd LLL')}`
}

export const money = (m: Money | null | undefined) => formatMoney(m) ?? null

/** Major-unit string for form fields ("45.5" → "45.50"; whole amounts without decimals). */
export function majorString(m: Money | null | undefined): string {
  if (!m) return ''
  const s = toMajorString(m)
  return s.endsWith('.00') ? s.slice(0, -3) : s
}

export function hoursText(h: number | null | undefined): string | null {
  if (h == null) return null
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (!whole) return `${mins} min`
  return mins ? `${whole} h ${mins} min` : `${whole} h`
}

export const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const

/** The label already says "your guess", so a trailing "my guess" in the text is dropped for display only. */
export function crowdText(s: string | null): string | null {
  if (!s) return null
  const t = s.replace(/[\s,;:—–-]*\(?\bmy guess\b\)?\.?\s*$/i, '').trim()
  return t || s
}

export const TIME_PRESETS = ['Early morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night'] as const
export const CROWD_PRESETS = ['Quiet', 'Moderate', 'Busy', 'Very busy'] as const

export const LESSON_KINDS = ['group', 'private', 'semi-private', 'clinic'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]
export const LESSON_KIND_LABEL: Record<string, string> = {
  group: 'Group lesson',
  private: 'Private lesson',
  'semi-private': 'Semi-private lesson',
  clinic: 'Clinic',
}

export const COST_KIND_LABEL: Record<string, string> = { quote: 'Quote', estimate: 'Estimate', actual: 'Actual' }

export const CATEGORY_LABEL: Record<BudgetCategory, string> = {
  pass: 'Season pass',
  lift: 'Lift tickets',
  lodging: 'Lodging',
  travel: 'Travel',
  food: 'Food',
  lessons: 'Lessons',
  rentals: 'Rentals',
  gear: 'Gear',
  other: 'Other',
}

/** Your currency first, then the app-wide supported list, then any other code already used. */
export function currencies(preferred: string, ...more: (string | null | undefined)[]): string[] {
  return currencyChoicesFor(preferred, ...more)
}

/** Resort-page link for a resort id. */
export const resortHref = (id: string) => `/resorts/${id}`
export const tripHref = (id: string) => `/trips/${id}`

/** Where the season-budget figures come from (for the source drawer): my own records, computed by Piste. */
export function budgetProvenance(seasonLabel: string): Provenance {
  return provenance({
    kind: 'derived',
    provider: 'Piste season budget, from your records',
    verification: 'user-confirmed',
    note: `Actual = your recorded expenses in ${seasonLabel} (a pass purchase linked to the pass is counted once, whatever its date). Planned = your share of priced items on non-cancelled trips; ideas are left out. Cost per ski day divides actual spending by distinct ski days (journal days and pass days).`,
  })
}

/** Pass "ticket value" is Piste's calculation from each used day's own ticket price on file. */
export const PASS_VALUE_PROVENANCE: Provenance = provenance({
  kind: 'derived',
  provider: 'Piste, from ticket prices on file',
  note: 'Each pass day is valued at that resort’s own day-ticket price for that date (weekday, weekend or holiday), from the price records on the resort page. Days without a known price are left out and counted as unknown. It is not added to spending, and it is not cash saved unless you would have skied those days anyway.',
})
