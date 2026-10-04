/**
 * Builds the journey (legs + pins) for a plan and the chosen way to go. Pure: no DOM, no network.
 *
 * Every drive leg (home → resort, home → departure airport, gateway → resort) uses the bundled road geometry when the
 * plan carries it (`geometry: 'road'`). Without it the leg is `missing`: its coordinates are only the two endpoints,
 * used to frame the camera, and the maps never draw a straight line for it (the online map may still fetch a route).
 * The flight is a static, illustrative great-circle arc. Longitudes after the arc are unwrapped so a journey across the
 * antimeridian stays continuous (the transfer road is shifted with it).
 */
import type { RideAirport, RidePlan, RideRoad } from '@/lib/data/ride'
import { greatCircleArc, haversineKm, pathKm, type LonLat } from '@/lib/domain/journey'

export type RideMode = 'drive' | 'fly'
export type LegKind = 'drive' | 'ground' | 'air' | 'transfer'
export type LegGeometry = 'road' | 'arc' | 'missing'

export interface Leg {
  kind: LegKind
  from: LonLat
  to: LonLat
  coords: LonLat[]
  fromLabel: string
  toLabel: string
  /** Minutes for the leg (routed or recorded), null when unknown or (flights) never shown. */
  minutes: number | null
  /** Road geometry, an illustrative flight arc, or no geometry (endpoints only — never drawn as a line). */
  geometry: LegGeometry
  km: number
  /** External directions for a road leg (shown when its geometry is missing offline). */
  directionsUrl: string | null
}

export interface Pin {
  id: string
  at: LonLat
  label: string
  /** Second, quieter part of the label (airport city). */
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

/** What can actually be shown for a plan: drive needs a drive time or at least no airports; fly needs a gateway. */
export function availableModes(plan: RidePlan): RideMode[] {
  const out: RideMode[] = []
  if (plan.drive || !plan.gateways.length) out.push('drive')
  if (plan.gateways.length && plan.origins.length) out.push('fly')
  return out
}

/** Resolve a requested selection against the plan (invalid or missing parts fall back to the recommended option). */
export function resolveSelection(plan: RidePlan, req: Partial<RideSelection>): RideSelection {
  const modes = availableModes(plan)
  const preferred: RideMode = plan.recommended === 'fly' && modes.includes('fly') ? 'fly' : (modes[0] ?? 'drive')
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
  return { id: 'resort', at, label: plan.resort.short, kind: 'resort' }
}

/** A road leg: the bundled geometry joined to the pins (a road starts where it meets the network), or `missing`. */
function roadLeg(kind: LegKind, from: LonLat, to: LonLat, fromLabel: string, toLabel: string, minutes: number | null, road: RideRoad | null | undefined, directionsUrl: string | null): Leg {
  if (!road || road.coords.length < 2) {
    return { kind, from, to, coords: [from, to], fromLabel, toLabel, minutes, geometry: 'missing', km: haversineKm(from, to), directionsUrl }
  }
  // Shift the road into the same longitude window as its endpoints (journeys unwrapped across the antimeridian).
  const shift = unwrapTo(from[0], road.coords[0][0]) - road.coords[0][0]
  const coords: LonLat[] = road.coords.map((c) => [c[0] + shift, c[1]])
  if (haversineKm(from, coords[0]) > 0.05) coords.unshift(from)
  if (haversineKm(coords[coords.length - 1], to) > 0.05) coords.push(to)
  return { kind, from, to, coords, fromLabel, toLabel, minutes: minutes ?? road.minutes, geometry: 'road', km: road.km || pathKm(coords), directionsUrl }
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
  const to: LonLat = [unwrapTo(home[0], resort[0]), resort[1]]
  const leg = roadLeg('drive', home, to, plan.home.name, plan.resort.short, plan.drive?.minutes ?? null, plan.roads.drive, plan.drive?.directionsUrl ?? null)
  return {
    key: `drive:${plan.resort.id}`,
    mode: 'drive',
    legs: [leg],
    pins: [homePin, resortPin(plan, to)],
  }
}

/** The city an airport serves: the recorded "(Zurich)" note when present, else the first part of its city. */
export function airportCity(a: Pick<RideAirport, 'city' | 'name' | 'iata'>): string {
  const served = a.city
    ?.match(/\(([^)]+)\)/)?.[1]
    ?.replace(/\s+area$/i, '')
    .trim()
  return served || a.city?.split(',')[0].trim() || a.name || a.iata
}

/** A short city name for an airport label (none when it would repeat the code or home, or run long). */
function airportSub(a: RideAirport, homeName: string): string | undefined {
  const c = airportCity(a)
  if (!c || c.length > 16 || c.toUpperCase() === a.iata) return undefined
  return homeName.toLowerCase().startsWith(c.toLowerCase()) ? undefined : c
}

function flyJourney(plan: RidePlan, origin: RideAirport, gw: RideAirport, homePin: Pin): Journey {
  const home = homePin.at
  const dep: LonLat = [unwrapTo(home[0], origin.lon), origin.lat]
  const ground = roadLeg('ground', home, dep, plan.home.name, origin.iata, origin.minutes, plan.roads.origins[origin.iata], origin.directionsUrl)
  const arc = greatCircleArc(dep, [gw.lon, gw.lat], 160)
  const arr = arc[arc.length - 1]
  const air: Leg = { kind: 'air', from: dep, to: arr, coords: arc, fromLabel: origin.iata, toLabel: gw.iata, minutes: null, geometry: 'arc', km: pathKm(arc), directionsUrl: null }
  const resort: LonLat = [unwrapTo(arr[0], plan.resort.lon), plan.resort.lat]
  const transfer = roadLeg('transfer', arr, resort, gw.iata, plan.resort.short, gw.minutes, plan.roads.gateways[gw.iata], gw.directionsUrl)
  const atAirport = haversineKm(home, dep) < 0.3
  const legs = atAirport ? [air, transfer] : [ground, air, transfer]
  return {
    key: `fly:${plan.resort.id}:${origin.iata}:${gw.iata}`,
    mode: 'fly',
    legs,
    pins: [
      homePin,
      ...(atAirport ? [] : [{ id: `dep-${origin.iata}`, at: dep, label: origin.iata, sub: airportSub(origin, plan.home.name), kind: 'airport' as const }]),
      { id: `arr-${gw.iata}`, at: arr, label: gw.iata, sub: airportSub(gw, plan.home.name), kind: 'airport' },
      resortPin(plan, resort),
    ],
  }
}

/** All coordinates of a journey (for fitting the camera). */
export function journeyCoords(j: Journey): LonLat[] {
  return j.legs.flatMap((l) => l.coords)
}

/** Road legs with no geometry (the maps say so and link to directions instead of drawing a line). */
export function missingRoads(j: Journey | null): Leg[] {
  return j ? j.legs.filter((l) => l.geometry === 'missing') : []
}

export const LEG_TITLE: Record<LegKind, string> = {
  drive: 'Drive',
  ground: 'To the airport',
  air: 'Flight',
  transfer: 'Transfer',
}
