/**
 * Trip travel model (pure): itinerary timing from the times YOU entered, and door-to-door travel with every
 * planning assumption explicit.
 *
 * - Flight times come only from a manual itinerary (or a saved offer). Nothing is estimated from distance and no
 *   schedule is invented; without times the flight leg is unknown and the door-to-door total stays unknown.
 * - Segment times are airport-local wall times. Elapsed time needs both airports' IANA zones; an airport whose zone
 *   Piste does not know leaves that duration unknown instead of guessing an offset.
 * - Ground legs are curated estimates; the winter buffer (your Settings value) is applied to them explicitly.
 * - Airport and arrival buffers are planning assumptions with defaults you can change per flight.
 */
import { DateTime } from 'luxon'

export const DEFAULT_AIRPORT_BUFFER_MIN = 90
export const DEFAULT_ARRIVAL_BUFFER_MIN = 45
/** A layover this long, or one that crosses local midnight, is flagged as overnight. */
export const OVERNIGHT_LAYOVER_MIN = 6 * 60

export interface SegmentLike {
  carrier?: string | null
  flightNumber?: string | null
  from?: string | null
  to?: string | null
  /** 'YYYY-MM-DDTHH:mm' airport-local wall time. */
  departLocal?: string | null
  arriveLocal?: string | null
}

export interface Layover {
  at: string
  minutes: number | null
  overnight: boolean
}

export interface ItineraryTiming {
  /** First departure → final arrival, including connections; null when unknown. */
  totalMinutes: number | null
  connections: number
  layovers: Layover[]
  /** Why a duration is unknown or looks wrong. */
  issues: string[]
  first: SegmentLike | null
  last: SegmentLike | null
}

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function at(local: string | null | undefined, zone: string | null | undefined): DateTime | null {
  if (!local || !LOCAL_RE.test(local) || !zone) return null
  const dt = DateTime.fromISO(local, { zone })
  return dt.isValid ? dt : null
}

/** Timing for a manual itinerary. `zones` maps IATA → IANA zone (airports Piste knows). */
export function itineraryTiming(segments: readonly SegmentLike[], zones: Readonly<Record<string, string>>): ItineraryTiming {
  const segs = segments.filter((s) => s && (s.from || s.to || s.departLocal || s.arriveLocal))
  const issues: string[] = []
  if (!segs.length) return { totalMinutes: null, connections: 0, layovers: [], issues, first: null, last: null }
  const first = segs[0]
  const last = segs[segs.length - 1]
  const zoneOf = (code: string | null | undefined) => (code ? (zones[code.toUpperCase()] ?? null) : null)

  let totalMinutes: number | null = null
  const dep = at(first.departLocal, zoneOf(first.from))
  const arr = at(last.arriveLocal, zoneOf(last.to))
  if (!first.departLocal || !last.arriveLocal) issues.push('Add the first departure and final arrival times to time the journey')
  else if (!zoneOf(first.from) || !zoneOf(last.to)) {
    const unknown = [first.from, last.to].filter((c) => c && !zoneOf(c))
    issues.push(`Time zone not on file for ${unknown.length ? unknown.join(' and ') : 'an airport'} — elapsed time not computed`)
  } else if (dep && arr) {
    const m = Math.round(arr.diff(dep, 'minutes').minutes)
    if (m <= 0) issues.push('The final arrival is before the first departure — check the times')
    else if (m > 48 * 60) issues.push('More than 48 hours door to gate — check the dates')
    else totalMinutes = m
  }

  const layovers: Layover[] = []
  for (let k = 1; k < segs.length; k++) {
    const prev = segs[k - 1]
    const next = segs[k]
    const code = (next.from ?? prev.to ?? '').toUpperCase() || '—'
    if (prev.to && next.from && prev.to.toUpperCase() !== next.from.toUpperCase()) issues.push(`Arrive ${prev.to.toUpperCase()} but depart ${next.from.toUpperCase()} — an airport change needs its own transfer time`)
    // Both times are local to the connecting airport: its zone gives exact DST handling; without it, wall-clock
    // difference is still right except across a DST switch, so it is shown but never used for the total.
    const zone = zoneOf(code) ?? 'UTC'
    const a = at(prev.arriveLocal, zone)
    const d = at(next.departLocal, zone)
    const minutes = a && d ? Math.round(d.diff(a, 'minutes').minutes) : null
    if (minutes !== null && minutes < 0) issues.push(`Connection at ${code} departs before the previous flight lands`)
    const crossesMidnight = !!(a && d && a.toISODate() !== d.toISODate())
    layovers.push({ at: code, minutes: minutes !== null && minutes >= 0 ? minutes : null, overnight: crossesMidnight || (minutes !== null && minutes >= OVERNIGHT_LAYOVER_MIN) })
  }
  return { totalMinutes, connections: segs.length - 1, layovers, issues, first, last }
}

export type LegBasis = 'estimate' | 'assumption' | 'itinerary' | 'unknown'

export interface DoorLeg {
  key: 'drive-to-airport' | 'airport-buffer' | 'flight' | 'arrival-buffer' | 'transfer'
  label: string
  /** Minutes including the winter buffer where it applies; null = unknown. */
  minutes: number | null
  /** Minutes before the winter buffer (ground legs). */
  baseMinutes: number | null
  basis: LegBasis
  note: string
}

export interface DoorToDoor {
  legs: DoorLeg[]
  /** Sum of every leg; null while any leg is unknown. */
  total: number | null
  /** Sum of the known legs (shown as "at least"). */
  known: number
  unknown: string[]
}

export function doorToDoor(input: {
  originIata: string
  homeName: string
  /** Home → origin airport drive (curated estimate). */
  driveToAirport: number | null
  airportBuffer: number
  flightMinutes: number | null
  arrivalBuffer: number
  destinationIata: string | null
  resortName: string
  /** Destination airport → resort (curated estimate). */
  transferMinutes: number | null
  winterPct: number
}): DoorToDoor {
  const w = (m: number | null) => (m === null ? null : Math.round(m * (1 + input.winterPct / 100)))
  const legs: DoorLeg[] = [
    {
      key: 'drive-to-airport',
      label: `${input.homeName} → ${input.originIata}`,
      baseMinutes: input.driveToAirport,
      minutes: w(input.driveToAirport),
      basis: input.driveToAirport === null ? 'unknown' : 'estimate',
      note: input.driveToAirport === null ? 'No drive estimate on file for this airport' : `Curated estimate + ${input.winterPct}% winter buffer`,
    },
    {
      key: 'airport-buffer',
      label: `Check-in and security at ${input.originIata}`,
      baseMinutes: input.airportBuffer,
      minutes: input.airportBuffer,
      basis: 'assumption',
      note: 'Your planning assumption — arrive this long before departure',
    },
    {
      key: 'flight',
      label: input.destinationIata ? `Flights ${input.originIata} → ${input.destinationIata}` : 'Flights',
      baseMinutes: input.flightMinutes,
      minutes: input.flightMinutes,
      basis: input.flightMinutes === null ? 'unknown' : 'itinerary',
      note: input.flightMinutes === null ? 'Unknown until you enter your itinerary times' : 'From the times you entered, connections included',
    },
    {
      key: 'arrival-buffer',
      label: input.destinationIata ? `Bags and pick-up at ${input.destinationIata}` : 'Bags and pick-up',
      baseMinutes: input.arrivalBuffer,
      minutes: input.arrivalBuffer,
      basis: 'assumption',
      note: 'Your planning assumption',
    },
    {
      key: 'transfer',
      label: `${input.destinationIata ?? 'Airport'} → ${input.resortName}`,
      baseMinutes: input.transferMinutes,
      minutes: w(input.transferMinutes),
      basis: input.transferMinutes === null ? 'unknown' : 'estimate',
      note: input.transferMinutes === null ? 'No transfer estimate on file' : `Curated estimate + ${input.winterPct}% winter buffer`,
    },
  ]
  const unknown = legs.filter((l) => l.minutes === null).map((l) => l.label)
  const known = legs.reduce((sum, l) => sum + (l.minutes ?? 0), 0)
  return { legs, total: unknown.length ? null : known, known, unknown }
}

// ---------------------------------------------------------------------------
// Budget breakdown

/** The budget-line fields the breakdown needs (a TripBudgetLine subset). */
export interface BudgetLineLike {
  type: string
  groupTotal: { min: { amountMinor: number }; max: { amountMinor: number } } | null
}

export interface CategoryTotal<K extends string = string> {
  key: K
  lines: number
  /** Whole party, display currency (minor units). */
  min: number
  max: number
}

/** Group priced budget lines into categories (display currency, whole party). Unpriced lines are not counted. */
export function categoryTotals<K extends string>(lines: readonly BudgetLineLike[], categoryOf: (type: string) => K, order: readonly K[]): CategoryTotal<K>[] {
  const by = new Map<K, CategoryTotal<K>>()
  for (const l of lines) {
    if (!l.groupTotal) continue
    const key = categoryOf(l.type)
    const cur = by.get(key) ?? { key, lines: 0, min: 0, max: 0 }
    cur.lines += 1
    cur.min += l.groupTotal.min.amountMinor
    cur.max += l.groupTotal.max.amountMinor
    by.set(key, cur)
  }
  return order.map((k) => by.get(k)).filter((x): x is CategoryTotal<K> => !!x && (x.max > 0 || x.lines > 0))
}
