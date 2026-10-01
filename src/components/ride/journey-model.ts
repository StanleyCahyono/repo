/**
 * Builds the animated journey (legs + pins) for a plan and the chosen way to go. Pure: no DOM, no network.
 *
 * Drive: one leg home → resort. Its geometry starts as a straight line flagged `approx`; the online map may swap in
 * road geometry from a routing service, and says so. Fly: ground leg to the chosen departure airport (straight,
 * approximate), an illustrative great-circle arc to the gateway, then the transfer to the resort (straight,
 * approximate). Longitudes after the arc are unwrapped so a journey across the antimeridian stays continuous.
 */
import type { RideAirport, RidePlan } from '@/lib/data/ride'
import { greatCircleArc, pathKm, type LonLat } from '@/lib/domain/journey'
import { formatElevation } from '@/lib/domain/units'

export type RideMode = 'drive' | 'fly'
export type LegKind = 'drive' | 'ground' | 'air' | 'transfer'

export interface Leg {
  kind: LegKind
  from: LonLat
  to: LonLat
  coords: LonLat[]
  fromLabel: string
  toLabel: string
  /** Recorded minutes for the leg (estimate), null when unknown or (flights) never shown. */
  minutes: number | null
  /** Straight line or illustrative arc rather than real geometry. */
  approx: boolean
  km: number
}

export interface Pin {
  id: string
  at: LonLat
  label: string
  /** Second line (resort: summit elevation when recorded). */
  sub?: string
  kind: 'home' | 'airport' | 'resort'
}

export interface Journey {
  key: string
  mode: RideMode
  legs: Leg[]
  pins: Pin[]
}

export interface RideSelection {
  mode: RideMode
  /** Gateway IATA (fly). */
  via: string | null
  /** Departure IATA (fly). */
  from: string | null
}

/** What can actually be shown for a plan: drive needs a drive estimate or at least no airports; fly needs a gateway. */
export function availableModes(plan: RidePlan): RideMode[] {
  const out: RideMode[] = []
  if (plan.drive || !plan.gateways.length) out.push('drive')
  if (plan.gateways.length && plan.origins.length) out.push('fly')
  return out
}

/** Resolve a requested selection against the plan (invalid or missing parts fall back to the recommended option). */
export function resolveSelection(plan: RidePlan, req: Partial<RideSelection>): RideSelection {
  const modes = availableModes(plan)
  const preferred: RideMode = plan.recommended === 'fly' && modes.includes('fly') ? 'fly' : modes[0] ?? 'drive'
  const mode = req.mode && modes.includes(req.mode) ? req.mode : preferred
  const via = plan.gateways.find((g) => g.iata === req.via)?.iata ?? plan.gateways[0]?.iata ?? null
  const from = plan.origins.find((o) => o.iata === req.from)?.iata ?? plan.origins[0]?.iata ?? null
  return { mode, via, from }
}

const ll = (p: { lon: number; lat: number }): LonLat => [p.lon, p.lat]

function unwrapTo(ref: number, lon: number): number {
  let x = lon
  while (x - ref > 180) x -= 360
  while (x - ref < -180) x += 360
  return x
}

function resortPin(plan: RidePlan, at: LonLat): Pin {
  const summit = formatElevation(plan.resort.summitM, plan.units)
  return { id: 'resort', at, label: plan.resort.short, sub: summit ? `Summit ${summit}` : undefined, kind: 'resort' }
}

function straight(kind: LegKind, from: LonLat, to: LonLat, fromLabel: string, toLabel: string, minutes: number | null): Leg {
  const coords: LonLat[] = [from, to]
  return { kind, from, to, coords, fromLabel, toLabel, minutes, approx: true, km: pathKm(coords) }
}

export function buildJourney(plan: RidePlan, sel: RideSelection): Journey {
  const home = ll(plan.home)
  const resort = ll(plan.resort)
  const homePin: Pin = { id: 'home', at: home, label: plan.home.name, kind: 'home' }
  if (sel.mode === 'fly') {
    const origin = plan.origins.find((o) => o.iata === sel.from) ?? plan.origins[0]
    const gw = plan.gateways.find((g) => g.iata === sel.via) ?? plan.gateways[0]
    if (origin && gw) return flyJourney(plan, origin, gw, homePin)
  }
  const leg = straight('drive', home, [unwrapTo(home[0], resort[0]), resort[1]], plan.home.name, plan.resort.short, plan.drive?.minutes ?? null)
  return {
    key: `drive:${plan.resort.id}`,
    mode: 'drive',
    legs: [leg],
    pins: [homePin, resortPin(plan, leg.to)],
  }
}

function flyJourney(plan: RidePlan, origin: RideAirport, gw: RideAirport, homePin: Pin): Journey {
  const home = homePin.at
  const dep: LonLat = [unwrapTo(home[0], origin.lon), origin.lat]
  const ground = straight('ground', home, dep, plan.home.name, origin.iata, origin.minutes)
  const arc = greatCircleArc(dep, [gw.lon, gw.lat], 160)
  const arr = arc[arc.length - 1]
  const air: Leg = { kind: 'air', from: dep, to: arr, coords: arc, fromLabel: origin.iata, toLabel: gw.iata, minutes: null, approx: true, km: pathKm(arc) }
  const resort: LonLat = [unwrapTo(arr[0], plan.resort.lon), plan.resort.lat]
  const transfer = straight('transfer', arr, resort, gw.iata, plan.resort.short, gw.minutes)
  const legs = ground.km < 0.3 ? [air, transfer] : [ground, air, transfer]
  return {
    key: `fly:${plan.resort.id}:${origin.iata}:${gw.iata}`,
    mode: 'fly',
    legs,
    pins: [
      homePin,
      ...(ground.km < 0.3 ? [] : [{ id: `dep-${origin.iata}`, at: dep, label: origin.iata, kind: 'airport' as const }]),
      { id: `arr-${gw.iata}`, at: arr, label: gw.iata, kind: 'airport' },
      resortPin(plan, resort),
    ],
  }
}

/** All coordinates of a journey (for fitting the camera). */
export function journeyCoords(j: Journey): LonLat[] {
  return j.legs.flatMap((l) => l.coords)
}

export const LEG_TITLE: Record<LegKind, string> = {
  drive: 'Drive',
  ground: 'To the airport',
  air: 'Flight · illustrative',
  transfer: 'Transfer',
}
