/**
 * Range-calendar model (pure): Monday-first month grids on local YYYY-MM-DD strings, the selection rule (tap a start,
 * then an end), and the band segment each week row draws. No Date local-time arithmetic — dates are plain strings.
 */
import { addDays, daysBetween } from '@/lib/domain/time'

/** 'YYYY-MM' of a date. */
export const monthOf = (date: string) => date.slice(0, 7)

export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/** ISO weekday of a date, Monday = 0 … Sunday = 6 (Zeller-free: from a known Monday). */
export function weekdayIndex(date: string): number {
  // 2001-01-01 was a Monday.
  const d = daysBetween('2001-01-01', date)
  return ((d % 7) + 7) % 7
}

/** Weeks of a month, Monday first; cells outside the month are null. */
export function monthGrid(ym: string): (string | null)[][] {
  const first = `${ym}-01`
  const lead = weekdayIndex(first)
  const n = daysInMonth(ym)
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 0; d < n; d++) cells.push(addDays(first, d))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Next selection after tapping `day`: a start, then an end on or after it; tapping before the start restarts. */
export function pickDay(start: string | null, end: string | null, day: string): { start: string; end: string | null } {
  if (!start || end || day < start) return { start: day, end: null }
  return { start, end: day }
}

/** Columns [c0, c1] of a week covered by the range [a, b] (inclusive), or null. */
export function bandSegment(week: readonly (string | null)[], a: string | null, b: string | null): { c0: number; c1: number; startsHere: boolean; endsHere: boolean } | null {
  if (!a || !b || b < a) return null
  let c0 = -1
  let c1 = -1
  week.forEach((d, i) => {
    if (d && d >= a && d <= b) {
      if (c0 < 0) c0 = i
      c1 = i
    }
  })
  if (c0 < 0) return null
  return { c0, c1, startsHere: week[c0] === a, endsHere: week[c1] === b }
}

/** "4 nights · 5 days" style counts for a complete range. */
export function nightsOf(a: string, b: string): { nights: number; days: number } {
  const nights = Math.max(0, daysBetween(a, b))
  return { nights, days: nights + 1 }
}
