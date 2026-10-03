/**
 * Calendar model (pure, framework-free): month grids, date arithmetic, constraints, keyboard navigation, range
 * picking, presets and friendly formatting — all on local 'YYYY-MM-DD' strings.
 *
 * Dates are calendar days, not instants: there is no `Date` local-time arithmetic here. Days are converted to a day
 * number (days since 1970-01-01, proleptic Gregorian) and back, so the results never depend on the process time zone.
 * Shared by the date pickers (ui/date-picker) and the trip range calendar (trips/range-calendar).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Day numbers

/** Day of the week a week starts on, JavaScript style: 0 = Sunday, 1 = Monday … 6 = Saturday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, '0')

/** A real calendar day written as 'YYYY-MM-DD' (rejects 2027-02-30, '2027-2-3', ''). */
export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = ISO_DATE.exec(s)
  if (!m) return false
  const mo = Number(m[2])
  const d = Number(m[3])
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(`${m[1]}-${m[2]}`)
}

/** Days since 1970-01-01 (days_from_civil). */
export function dayNumber(date: string): number {
  let y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** 'YYYY-MM-DD' of a day number (civil_from_days). */
export function fromDayNumber(n: number): string {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`
}

export const addDays = (date: string, n: number) => fromDayNumber(dayNumber(date) + n)
/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => dayNumber(b) - dayNumber(a)

// ---------------------------------------------------------------------------------------------------------------------
// Months and weeks

/** 'YYYY-MM' of a date. */
export const monthOf = (date: string) => date.slice(0, 7)

export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${pad(mm + 1)}`
}

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

/** Same day of the month `n` months later, clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsToDate(date: string, n: number): string {
  const ym = addMonths(monthOf(date), n)
  return `${ym}-${pad(Math.min(Number(date.slice(8, 10)), daysInMonth(ym)))}`
}

export const addYearsToDate = (date: string, n: number) => addMonthsToDate(date, n * 12)

/** Day of the week, JavaScript style: 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function dayOfWeek(date: string): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7
}

/** ISO weekday index, Monday = 0 … Sunday = 6. */
export const weekdayIndex = (date: string) => (dayOfWeek(date) + 6) % 7

/** Column of a date in a week that starts on `weekStartsOn` (0–6). */
export const columnOf = (date: string, weekStartsOn: WeekStart = 1) => (dayOfWeek(date) - weekStartsOn + 7) % 7
export const startOfWeek = (date: string, weekStartsOn: WeekStart = 1) => addDays(date, -columnOf(date, weekStartsOn))
export const endOfWeek = (date: string, weekStartsOn: WeekStart = 1) => addDays(date, 6 - columnOf(date, weekStartsOn))

/** Weeks of a month (Monday first by default); cells outside the month are null. 4–6 rows. */
export function monthGrid(ym: string, weekStartsOn: WeekStart = 1): (string | null)[][] {
  const first = `${ym}-01`
  const lead = columnOf(first, weekStartsOn)
  const n = daysInMonth(ym)
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  const base = dayNumber(first)
  for (let d = 0; d < n; d++) cells.push(fromDayNumber(base + d))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** `n` consecutive months starting at `ym`. */
export const visibleMonths = (ym: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(ym, i))

// ---------------------------------------------------------------------------------------------------------------------
// Constraints

export interface DateConstraints {
  /** Earliest selectable day (inclusive). */
  min?: string | null
  /** Latest selectable day (inclusive). */
  max?: string | null
  /** Any other day that cannot be picked (it stays focusable, dimmed and struck through). */
  isDateDisabled?: (date: string) => boolean
}

export function clampDate(date: string, min?: string | null, max?: string | null): string {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

export const isOutOfRange = (date: string, c: DateConstraints) => (!!c.min && date < c.min) || (!!c.max && date > c.max)
export const isDisabledDay = (date: string, c: DateConstraints) => isOutOfRange(date, c) || !!c.isDateDisabled?.(date)

/** Can the calendar show `ym` as its first month (with `count` months visible) inside min/max? */
export function canShowMonth(ym: string, c: DateConstraints, count = 1): boolean {
  if (c.min && addMonths(ym, count - 1) < monthOf(c.min)) return false
  if (c.max && ym > monthOf(c.max)) return false
  return true
}

/** First month to show: the value's month, else today's, else the nearest month inside min/max. */
export function initialMonth(anchor: string | null | undefined, today: string, c: DateConstraints): string {
  return monthOf(clampDate(isISODate(anchor) ? anchor : today, c.min, c.max))
}

/** Day that receives focus when a calendar opens: the value, else today, clamped into min/max. */
export function initialFocus(anchor: string | null | undefined, today: string, c: DateConstraints): string {
  return clampDate(isISODate(anchor) ? anchor : today, c.min, c.max)
}

/** First month of the visible window after focus moves to `date` (keeps the window when the day is already shown). */
export function windowFor(date: string, view: string, count: number): string {
  const m = monthOf(date)
  if (m < view) return m
  const last = addMonths(view, count - 1)
  if (m > last) return addMonths(m, -(count - 1))
  return view
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard

export type CalendarKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown' | 'Home' | 'End'
export const CALENDAR_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']

/**
 * The day focus moves to for a grid key (WAI-ARIA date picker pattern): arrows by day / week, PageUp/PageDown by
 * month, Shift+PageUp/PageDown by year, Home/End to the week's first / last day. Clamped into min/max so focus never
 * wanders into months that cannot be picked. Null for any other key.
 */
export function navigateDate(from: string, key: string, opts: { shift?: boolean; weekStartsOn?: WeekStart; min?: string | null; max?: string | null } = {}): string | null {
  const ws = opts.weekStartsOn ?? 1
  let to: string
  switch (key) {
    case 'ArrowLeft':
      to = addDays(from, -1)
      break
    case 'ArrowRight':
      to = addDays(from, 1)
      break
    case 'ArrowUp':
      to = addDays(from, -7)
      break
    case 'ArrowDown':
      to = addDays(from, 7)
      break
    case 'PageUp':
      to = opts.shift ? addYearsToDate(from, -1) : addMonthsToDate(from, -1)
      break
    case 'PageDown':
      to = opts.shift ? addYearsToDate(from, 1) : addMonthsToDate(from, 1)
      break
    case 'Home':
      to = startOfWeek(from, ws)
      break
    case 'End':
      to = endOfWeek(from, ws)
      break
    default:
      return null
  }
  return clampDate(to, opts.min, opts.max)
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranges

export interface DateRange {
  start: string | null
  end: string | null
}

/** Next selection after tapping `day`: a start, then an end on or after it; tapping before the start restarts. */
export function pickDay(start: string | null, end: string | null, day: string): { start: string; end: string | null } {
  if (!start || end || day < start) return { start: day, end: null }
  return { start, end: day }
}

/**
 * `pickDay` with an optional longest range: an end that would make the range longer than `maxDays` days starts a new
 * range at that day instead (the band never stretches past what the caller allows).
 */
export function pickRange(range: DateRange, day: string, opts: { maxDays?: number } = {}): { start: string; end: string | null } {
  const next = pickDay(range.start, range.end, day)
  if (next.end && opts.maxDays && daysBetween(next.start, next.end) + 1 > opts.maxDays) return { start: day, end: null }
  return next
}

/** The band to draw: the chosen range, or a preview to the hovered / focused day while the end is being picked. */
export function bandRange(range: DateRange, hover: string | null): { from: string; to: string; preview: boolean } | null {
  if (range.start && range.end) return { from: range.start, to: range.end, preview: false }
  if (range.start && hover && hover > range.start) return { from: range.start, to: hover, preview: true }
  return null
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

/** "2 nights · 3 days" / "Day trip · 1 day". */
export function nightsLabel(a: string, b: string): string {
  const { nights, days } = nightsOf(a, b)
  return `${nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : 'Day trip'} · ${days} ${days === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Marks (opening days, events, season windows): drawn under the day number, always with text.

export type MarkTone = 'teal' | 'copper' | 'positive' | 'caution' | 'critical' | 'info' | 'demo' | 'ink'
export type MarkVariant = 'dot' | 'rule' | 'dashed'

export interface DateMark {
  /** First (or only) day. */
  date: string
  /** Last day for a window (inclusive). */
  to?: string
  /** Text for the legend and for each marked day's accessible name — marks never rely on colour alone. */
  label: string
  tone?: MarkTone
  variant?: MarkVariant
  /** Lighter glyph (e.g. an announced, not yet confirmed window). */
  soft?: boolean
}

export const marksOn = (marks: readonly DateMark[] | undefined, day: string): DateMark[] =>
  marks?.length ? marks.filter((m) => day >= m.date && day <= (m.to ?? m.date)) : []

/** Distinct marks touching any of `days` (for the legend), in the caller's order. */
export function legendFor(marks: readonly DateMark[] | undefined, days: readonly string[]): DateMark[] {
  if (!marks?.length || !days.length) return []
  const first = days[0]
  const last = days[days.length - 1]
  const seen = new Set<string>()
  const out: DateMark[] = []
  for (const m of marks) {
    if (m.date > last || (m.to ?? m.date) < first) continue
    if (!days.some((d) => d >= m.date && d <= (m.to ?? m.date))) continue
    const key = `${m.label}|${m.tone ?? 'teal'}|${m.variant ?? 'dot'}|${m.soft ? 1 : 0}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Formatting (English, deterministic — no Intl or time-zone dependence)

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export type DateStyle = 'full' | 'medium' | 'short' | 'day-month' | 'weekday-day'

/**
 * - full: "Saturday 16 January 2027" (accessible names)
 * - medium: "Sat 16 Jan 2027" (field triggers)
 * - short: "Sat 16 Jan" (compact triggers)
 * - day-month: "16 Jan"
 * - weekday-day: "Sat 16"
 * Anything that is not a real date formats as ''.
 */
export function formatDate(date: string | null | undefined, style: DateStyle = 'medium'): string {
  if (!isISODate(date)) return ''
  const y = date.slice(0, 4)
  const m = Number(date.slice(5, 7)) - 1
  const d = Number(date.slice(8, 10))
  const wd = dayOfWeek(date)
  switch (style) {
    case 'full':
      return `${WD_LONG[wd]} ${d} ${MON_LONG[m]} ${y}`
    case 'short':
      return `${WD_SHORT[wd]} ${d} ${MON_SHORT[m]}`
    case 'day-month':
      return `${d} ${MON_SHORT[m]}`
    case 'weekday-day':
      return `${WD_SHORT[wd]} ${d}`
    default:
      return `${WD_SHORT[wd]} ${d} ${MON_SHORT[m]} ${y}`
  }
}

/**
 * A range written once: "Sat 16 – Mon 18 Jan 2027", "Sat 30 Jan – Tue 2 Feb 2027", "Thu 31 Dec 2026 – Sat 2 Jan 2027".
 * `year: false` drops the year ("Sat 16 – Mon 18 Jan"). A start alone reads "Sat 16 Jan 2027 – …".
 */
export function formatRange(start: string | null | undefined, end: string | null | undefined, opts: { year?: boolean } = {}): string {
  const withYear = opts.year !== false
  if (!isISODate(start)) return ''
  const one = (d: string) => formatDate(d, withYear ? 'medium' : 'short')
  if (!isISODate(end)) return `${one(start)} – …`
  if (start === end) return one(start)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const tail = withYear ? ` ${end.slice(0, 4)}` : ''
  if (sameYear && start.slice(0, 7) === end.slice(0, 7)) return `${formatDate(start, 'weekday-day')} – ${formatDate(end, 'short')}${tail}`
  if (sameYear) return `${formatDate(start, 'short')} – ${formatDate(end, 'short')}${tail}`
  return `${formatDate(start, 'medium')} – ${formatDate(end, 'medium')}`
}

/** "January 2027". */
export const formatMonth = (ym: string) => `${MON_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const monthName = (ym: string, style: 'long' | 'short' = 'long') => (style === 'long' ? MON_LONG : MON_SHORT)[Number(ym.slice(5, 7)) - 1]

/** Weekday column headers for a week start: short ("Mo"), long ("Monday"), weekend flag. */
export function weekdayHeaders(weekStartsOn: WeekStart = 1): { short: string; long: string; weekend: boolean }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const wd = (weekStartsOn + i) % 7
    return { short: WD_SHORT[wd].slice(0, 2), long: WD_LONG[wd], weekend: wd === 0 || wd === 6 }
  })
}

/** "Today", "Tomorrow", "In 5 days", "In 3 weeks", "2 months ago" — relative to the app's `today`. */
export function relativeDay(date: string, today: string): string {
  const n = daysBetween(today, date)
  const a = Math.abs(n)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  const span = a < 14 ? `${a} days` : a < 60 ? `${Math.round(a / 7)} weeks` : a < 730 ? `${Math.round(a / 30.44)} months` : `${Math.round(a / 365.25)} years`
  return n > 0 ? `In ${span}` : `${span} ago`
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets

export type PresetId = 'today' | 'tomorrow' | 'this-weekend' | 'next-weekend' | 'next-7-days'

/** A caller-defined preset: `date` for a single day, or `start` + `end` for a range. */
export interface CustomPreset {
  label: string
  date?: string
  start?: string
  end?: string
}

export type PresetInput = PresetId | CustomPreset

export interface ResolvedPreset {
  key: string
  label: string
  start: string
  /** Same as `start` for single-day presets. */
  end: string
}

export const DEFAULT_PRESETS: Record<'single' | 'range', PresetId[]> = {
  single: ['today', 'tomorrow', 'this-weekend', 'next-weekend'],
  range: ['this-weekend', 'next-weekend', 'next-7-days'],
}

/** The weekend `today` is in (Sat–Sun; just Sunday on a Sunday), else the coming one. */
export function weekendFrom(today: string): { start: string; end: string } {
  const wd = dayOfWeek(today)
  if (wd === 0) return { start: today, end: today }
  const sat = addDays(today, 6 - wd)
  return { start: sat, end: addDays(sat, 1) }
}

const PRESET_LABEL: Record<PresetId, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  'this-weekend': 'This weekend',
  'next-weekend': 'Next weekend',
  'next-7-days': 'Next 7 days',
}

/** One preset's days from the app's `today` (never the device clock). Null when it has no meaning in this mode. */
export function resolvePreset(p: PresetInput, today: string, mode: 'single' | 'range'): ResolvedPreset | null {
  if (typeof p === 'object') {
    const start = p.start ?? p.date
    const end = p.end ?? start
    if (!isISODate(start) || !isISODate(end) || end < start) return null
    return { key: `custom:${p.label}`, label: p.label, start, end: mode === 'range' ? end : start }
  }
  let start: string
  let end: string
  switch (p) {
    case 'today':
      start = end = today
      break
    case 'tomorrow':
      start = end = addDays(today, 1)
      break
    case 'this-weekend':
      ;({ start, end } = weekendFrom(today))
      break
    case 'next-weekend': {
      const w = weekendFrom(today)
      // On a Sunday "this weekend" is just today, so next weekend is the coming Saturday.
      start = dayOfWeek(today) === 0 ? addDays(today, 6) : addDays(w.start, 7)
      end = addDays(start, 1)
      break
    }
    case 'next-7-days':
      if (mode === 'single') return null
      start = today
      end = addDays(today, 6)
      break
    default:
      return null
  }
  return { key: p, label: PRESET_LABEL[p], start, end: mode === 'single' ? start : end }
}

/** Presets that can be picked under the constraints (both ends selectable); others are dropped. */
export function resolvePresets(list: readonly PresetInput[], today: string, mode: 'single' | 'range', c: DateConstraints = {}, opts: { maxDays?: number } = {}): ResolvedPreset[] {
  const out: ResolvedPreset[] = []
  for (const p of list) {
    const r = resolvePreset(p, today, mode)
    if (!r || isDisabledDay(r.start, c) || isDisabledDay(r.end, c)) continue
    if (opts.maxDays && daysBetween(r.start, r.end) + 1 > opts.maxDays) continue
    // Same days as an earlier chip (on a Saturday, "This weekend" in single mode is just "Today"): keep the first.
    if (out.some((o) => o.key === r.key || (o.start === r.start && o.end === r.end))) continue
    out.push(r)
  }
  return out
}
