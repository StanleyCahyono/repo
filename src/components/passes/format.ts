/**
 * Labels and small formatters for the Passes & Costs screens. Client-safe: dates are formatted with Intl in UTC
 * (local dates are timezone-free strings), no Luxon.
 */
import { BadgePercent, CalendarOff, CalendarX2, CircleCheck, CircleHelp, CircleSlash, CircleX, Minus, type LucideIcon } from 'lucide-react'
import type { EstimateDayType, EstimateRental, EstimateSubject, EstimateView } from '@/lib/data/passes-screen'
import { formatMoneyRange } from '@/lib/domain/money'
import type { AccessStatus } from '@/lib/domain/passes/types'
import { PASS_FAMILIES, type PassAccessType, type PassFamilyId } from '@/lib/domain/types'

export type AccessTone = 'positive' | 'caution' | 'critical' | 'unknown' | 'neutral'

/** 'no-rule' = nothing recorded for this product at this resort (matrix cells). */
export type MarkStatus = AccessStatus | 'no-rule'

export interface StatusMeta {
  /** Full label for text and screen readers. */
  label: string
  /** Compact label for dense cells. */
  short: string
  tone: AccessTone
  Icon: LucideIcon
}

export const STATUS_META: Record<MarkStatus, StatusMeta> = {
  included: { label: 'Included', short: 'Included', tone: 'positive', Icon: CircleCheck },
  'included-limited': { label: 'Included (limited days)', short: 'Limited', tone: 'positive', Icon: CircleCheck },
  blackout: { label: 'Blacked out', short: 'Blackout', tone: 'critical', Icon: CalendarX2 },
  'days-exhausted': { label: 'No days left', short: 'No days', tone: 'critical', Icon: CircleSlash },
  'discount-only': { label: 'Discount only', short: 'Discount', tone: 'caution', Icon: BadgePercent },
  'not-included': { label: 'Not included', short: 'Not incl.', tone: 'critical', Icon: CircleX },
  unknown: { label: 'Not confirmed', short: 'Unconfirmed', tone: 'unknown', Icon: CircleHelp },
  'season-mismatch': { label: 'Different season', short: 'Season', tone: 'neutral', Icon: CalendarOff },
  'no-rule': { label: 'No rule recorded', short: 'No rule', tone: 'neutral', Icon: Minus },
}

/** Legend order. */
export const STATUS_ORDER: MarkStatus[] = ['included', 'included-limited', 'discount-only', 'blackout', 'days-exhausted', 'not-included', 'unknown', 'no-rule']

export const TONE_TEXT: Record<AccessTone, string> = {
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
  unknown: 'text-ink-2',
  neutral: 'text-ink-3',
}

export const TONE_CHIP: Record<AccessTone, string> = {
  positive: 'bg-positive-bg text-positive border-transparent',
  caution: 'bg-caution-bg text-caution border-transparent',
  critical: 'bg-critical-bg text-critical border-transparent',
  unknown: 'bg-transparent text-ink-2 border-dashed border-divider-strong',
  neutral: 'bg-surface-3 text-ink-2 border-transparent',
}

export const ACCESS_TYPE_LABEL: Record<PassAccessType, string> = {
  unlimited: 'Unlimited',
  'limited-days': 'Limited days',
  'shared-pool': 'Shared day pool',
  'discount-only': 'Discount only',
  'not-included': 'Not included',
  unknown: 'Unknown — not confirmed',
}

export const ACCESS_TYPE_HINT: Record<PassAccessType, string> = {
  unlimited: 'Ski any day that is not blacked out.',
  'limited-days': 'A fixed number of days at this resort.',
  'shared-pool': 'Days shared with other resorts on the same pass.',
  'discount-only': 'No included days — a discount on tickets.',
  'not-included': 'This pass does not include the resort.',
  unknown: 'Keep it unconfirmed — never treated as access.',
}

export function familyId(id: string): PassFamilyId {
  return (PASS_FAMILIES as readonly string[]).includes(id) ? (id as PassFamilyId) : 'regional'
}

// ---------------------------------------------------------------------------
// Dates (local 'YYYY-MM-DD', formatted in UTC so the day never shifts)

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o })
const WD = fmt({ weekday: 'short' })
const WD_LONG = fmt({ weekday: 'long' })
const MON = fmt({ month: 'short' })
const MON_LONG = fmt({ month: 'long' })

/** "16 Jan" — day first, like the rest of the app (Luxon 'd LLL'). */
function dm(d: Date, long = false): string {
  return `${d.getUTCDate()} ${(long ? MON_LONG : MON).format(d)}`
}

/** "Sat 16 Jan" (+ " 2027" with `year`). */
export function dayLabel(date: string, year = false): string {
  const d = utc(date)
  return `${WD.format(d)} ${dm(d)}${year ? ` ${d.getUTCFullYear()}` : ''}`
}

/** "Saturday 16 January 2027". */
export function dayLabelLong(date: string): string {
  const d = utc(date)
  return `${WD_LONG.format(d)} ${dm(d, true)} ${d.getUTCFullYear()}`
}

/** "16 Jan". */
export function dayMonth(date: string): string {
  return dm(utc(date))
}

/** "16 Jan 2027". */
export function shortDate(date: string): string {
  const d = utc(date)
  return `${dm(d)} ${d.getUTCFullYear()}`
}

export function weekdayShort(date: string): string {
  return WD.format(utc(date))
}

export function dayNumber(date: string): number {
  return utc(date).getUTCDate()
}

/** "Sat 16 – Mon 18 Jan 2027" / "Sat 16 Jan 2027". */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from, true)
  const a = utc(from)
  const b = utc(to)
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
  const left = sameMonth ? `${WD.format(a)} ${a.getUTCDate()}` : a.getUTCFullYear() === b.getUTCFullYear() ? dayLabel(from) : dayLabel(from, true)
  return `${left} – ${dayLabel(to, true)}`
}

/** "in 3 days" / "tomorrow" / "today" / "2 days ago". */
export function daysAway(n: number | null): string | null {
  if (n === null) return null
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** Instant (UTC ISO) → "28 Sep 2026" (UTC calendar date; good enough for "entered on"). */
export function instantDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  return shortDate(iso.slice(0, 10))
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function dotJoin(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' · ')
}

export const seasonText = (id: string) => id.replace('-', '–')

export function holderLabel(holder: string | null): string | null {
  if (!holder) return null
  return holder === 'me' ? 'Yours' : `${holder}’s`
}

// ---------------------------------------------------------------------------
// Your estimates

const SUBJECT_TEXT: Record<EstimateSubject, string> = { 'lift-ticket': 'lift ticket', rental: 'rental', parking: 'parking', 'pass-product': 'pass price' }
const RENTAL_TEXT: Record<EstimateRental, string> = { 'full-package': 'rental package', 'skis-only': 'ski rental', 'boots-only': 'boot rental' }
export const DAY_TYPE_LABEL: Record<EstimateDayType, string> = { weekday: 'Weekdays', weekend: 'Weekends', holiday: 'Holidays', any: 'Any day' }

/** "lift ticket", "ski rental", "pass price". */
export function estimateWhat(subject: EstimateSubject, rental?: EstimateRental | null): string {
  return subject === 'rental' && rental ? RENTAL_TEXT[rental] : SUBJECT_TEXT[subject]
}

/** "Your estimate · weekends · $89" — the label an estimate carries wherever it is used. */
export function estimateSummary(e: EstimateView): string {
  const when = e.subject === 'pass-product' ? null : DAY_TYPE_LABEL[e.dayType].toLowerCase()
  return ['Your estimate', when, formatMoneyRange(e.amount, e.amountMax)].filter(Boolean).join(' · ')
}
