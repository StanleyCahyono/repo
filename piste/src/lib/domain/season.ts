/**
 * Season-level helpers: opening labels and the *estimated* opening window derived from past openings.
 * An estimate is a Piste-derived planning aid and is always labelled "Estimated", never "Announced".
 */
import type { OpeningLabel } from './types'
import { addDays, daysBetween, type Hemisphere } from './time'

export interface SeasonDates {
  announcedOpening: string | null
  estimatedOpenFrom: string | null
  estimatedOpenTo: string | null
  actualOpening: string | null
  announcedClosing: string | null
  actualClosing: string | null
}

/**
 * Map a past opening date onto the target season, keeping month/day. Northern Hemisphere: Jul–Dec → the start year,
 * Jan–Jun → the end year. Southern Hemisphere: the whole winter is in the end year ('2026-27' is the 2027 winter),
 * so a July opening stays in July of that year.
 */
export function projectToSeason(date: string, targetSeason: string, hemisphere: Hemisphere = 'north'): string {
  const startYear = Number(targetSeason.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const year = hemisphere === 'south' || month < 7 ? startYear + 1 : startYear
  let md = date.slice(5)
  if (md === '02-29' && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) md = '02-28'
  return `${year}-${md}`
}

export interface OpeningEstimate {
  from: string
  to: string
  basis: string
}

/**
 * Estimated opening window from historical openings: [earliest, latest] projected onto the target season;
 * a single data point widens to ±7 days. Returns null without history.
 */
export function estimateOpeningWindow(
  history: { season: string; opened: string | null }[],
  targetSeason: string,
  hemisphere: Hemisphere = 'north',
): OpeningEstimate | null {
  const pts = history
    .filter((h) => h.opened && h.season !== targetSeason)
    .map((h) => ({ season: h.season, d: projectToSeason(h.opened!, targetSeason, hemisphere) }))
  if (pts.length === 0) return null
  const sorted = pts.map((p) => p.d).sort()
  let from = sorted[0]
  let to = sorted[sorted.length - 1]
  if (pts.length === 1) {
    from = addDays(from, -7)
    to = addDays(to, 7)
  }
  const seasons = pts.map((p) => p.season).sort()
  return {
    from,
    to,
    basis: `Piste estimate from opening ${pts.length === 1 ? 'date' : 'dates'} in ${seasons.join(', ')}${pts.length === 1 ? ' (±7 days)' : ''}. Weather and snowmaking decide the real date.`,
  }
}

/** Which opening label applies today. An announced date never becomes "Opened" by itself. */
export function openingLabel(s: SeasonDates, today: string): { label: OpeningLabel; date: string | null; to?: string | null } {
  if (s.actualOpening && s.actualOpening <= today) return { label: 'opened', date: s.actualOpening }
  if (s.announcedOpening) return { label: 'announced', date: s.announcedOpening }
  if (s.estimatedOpenFrom) return { label: 'estimated', date: s.estimatedOpenFrom, to: s.estimatedOpenTo }
  return { label: 'not-announced', date: null }
}

/** Days until a target date (negative when past). */
export function daysUntil(today: string, target: string): number {
  return daysBetween(today, target)
}
