/**
 * Journey geometry and timing for "Ride there". Pure, framework-free.
 *
 * - Great-circle arcs (flight legs are illustrative: a static arc between two airports, never a flight path or schedule).
 * - Distance along a polyline, the point and heading at a fraction of it (for the car glyph on a road draw-in).
 * - Road path simplification (bundled road geometry is thinned before it reaches the browser).
 * - "Leave by": the resort's published first-lift time minus the drive estimate (with the winter buffer).
 * - A plain effort label derived from a drive estimate.
 */
import { DateTime } from 'luxon'

/** [lon, lat] in degrees (GeoJSON order). */
export type LonLat = [number, number]

const R_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Haversine distance in km. */
export function haversineKm(a: LonLat, b: LonLat): number {
  const [l1, p1] = [rad(a[0]), rad(a[1])]
  const [l2, p2] = [rad(b[0]), rad(b[1])]
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Points along the great circle from a to b (inclusive), `n` segments. Longitudes are unwrapped so consecutive points
 * never jump by more than 180° (an arc across the antimeridian keeps going past ±180 instead of wrapping), which
 * keeps both map lines and schematic projections continuous.
 */
export function greatCircleArc(a: LonLat, b: LonLat, n = 128): LonLat[] {
  const [l1, p1] = [rad(a[0]), rad(a[1])]
  const [l2, p2] = [rad(b[0]), rad(b[1])]
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2)))
  if (d < 1e-9) return [a, b]
  const segs = Math.max(1, Math.round(n))
  const out: LonLat[] = []
  let prev: number | null = null
  for (let i = 0; i <= segs; i++) {
    const f = i / segs
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2)
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2)
    const z = A * Math.sin(p1) + B * Math.sin(p2)
    let lon = deg(Math.atan2(y, x))
    const lat = deg(Math.atan2(z, Math.sqrt(x * x + y * y)))
    if (prev !== null) {
      while (lon - prev > 180) lon -= 360
      while (lon - prev < -180) lon += 360
    } else {
      // Keep the start exactly where it was given (it may already be outside ±180 after unwrapping upstream).
      lon = a[0]
    }
    prev = lon
    out.push([lon, lat])
  }
  out[out.length - 1] = [out[out.length - 1][0], b[1]]
  return out
}

/** Cumulative km at each vertex (first is 0). */
export function cumulativeKm(coords: readonly LonLat[]): number[] {
  const c = [0]
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversineKm(coords[i - 1], coords[i]))
  return c
}

export function pathKm(coords: readonly LonLat[]): number {
  const c = cumulativeKm(coords)
  return c[c.length - 1] ?? 0
}

/**
 * The point at fraction `f` (0…1) of the path's length, with the index of the vertex after it (so the drawn part is
 * `coords.slice(0, index).concat([point])`). Linear interpolation between vertices.
 */
export function pointAlong(coords: readonly LonLat[], cum: readonly number[], f: number): { point: LonLat; index: number } {
  if (coords.length === 0) return { point: [0, 0], index: 0 }
  if (coords.length === 1) return { point: coords[0], index: 1 }
  const total = cum[cum.length - 1]
  const t = Math.max(0, Math.min(1, f)) * total
  let i = 1
  while (i < cum.length - 1 && cum[i] < t) i++
  const span = cum[i] - cum[i - 1] || 1
  const s = Math.max(0, Math.min(1, (t - cum[i - 1]) / span))
  const a = coords[i - 1]
  const b = coords[i]
  return { point: [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s], index: i }
}

/** Initial compass bearing a → b in degrees (0 = north, clockwise), in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const [l1, p1] = [rad(a[0]), rad(a[1])]
  const [l2, p2] = [rad(b[0]), rad(b[1])]
  const y = Math.sin(l2 - l1) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Shortest signed difference b − a between two angles, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  const d = (((b - a) % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

/** Ease-in-out (quadratic). */
export function easeInOut(f: number): number {
  const x = Math.max(0, Math.min(1, f))
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

/** Web Mercator y for a latitude (unitless, clamped near the poles). */
export function mercatorY(lat: number): number {
  const p = rad(Math.max(-85, Math.min(85, lat)))
  return Math.log(Math.tan(Math.PI / 4 + p / 2))
}

/**
 * How long a road takes to draw in on the map (ms): short drives are quick, long ones a little slower, capped so the
 * reveal stays a flourish rather than a wait. Flights are never animated.
 */
export function roadDrawMs(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return 1200
  return Math.round(Math.max(1200, Math.min(2600, 1000 + km * 4)))
}

/**
 * Douglas–Peucker simplification of a [lon, lat] path, tolerance in km (local equirectangular approximation, fine at
 * road scale). Keeps the first and last point; never returns fewer than two points for a path of two or more.
 */
export function simplifyPath(coords: readonly LonLat[], toleranceKm: number): LonLat[] {
  if (coords.length <= 2) return coords.slice()
  const lat0 = rad(coords[0][1])
  const kx = 111.32 * Math.cos(lat0)
  const ky = 110.57
  const xy = coords.map((c) => [c[0] * kx, c[1] * ky] as const)
  const keep = new Uint8Array(coords.length)
  keep[0] = 1
  keep[coords.length - 1] = 1
  const stack: [number, number][] = [[0, coords.length - 1]]
  const tol2 = toleranceKm * toleranceKm
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = xy[a]
    const [bx, by] = xy[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let worstD = tol2
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
      const ex = ax + t * dx - px
      const ey = ay + t * dy - py
      const d = ex * ex + ey * ey
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return coords.filter((_, i) => keep[i])
}

// ---------------------------------------------------------------------------
// Leave by

export interface LeaveByInput {
  /** Resort-local date (YYYY-MM-DD) of the ski day. */
  date: string
  /** Published first-lift time, HH:mm resort-local. */
  firstLift: string
  resortTz: string
  homeTz: string
  /** Drive minutes to plan with (the estimate including any winter buffer). */
  driveMinutes: number
}

export interface LeaveBy {
  /** UTC ISO instant to leave home. */
  leaveAt: string
  /** HH:mm in the home time zone. */
  leaveLocal: string
  /** Home-local date of departure (may be the day before for very long drives). */
  leaveDate: string
  /** UTC ISO instant of the first lift. */
  firstLiftAt: string
}

/** First lift minus the drive. Null when inputs are not usable (bad time, negative drive). */
export function leaveBy(i: LeaveByInput): LeaveBy | null {
  if (!/^\d{2}:\d{2}$/.test(i.firstLift) || !(i.driveMinutes >= 0) || !Number.isFinite(i.driveMinutes)) return null
  const [h, m] = i.firstLift.split(':').map(Number)
  const lift = DateTime.fromISO(i.date, { zone: i.resortTz }).set({ hour: h, minute: m, second: 0, millisecond: 0 })
  if (!lift.isValid) return null
  const leave = lift.minus({ minutes: Math.round(i.driveMinutes) }).setZone(i.homeTz)
  return {
    leaveAt: leave.toUTC().toISO()!,
    leaveLocal: leave.toFormat('HH:mm'),
    leaveDate: leave.toISODate()!,
    firstLiftAt: lift.toUTC().toISO()!,
  }
}

// ---------------------------------------------------------------------------
// Effort

export type Effort = 'low' | 'moderate' | 'high' | 'very-high'

/** A plain effort label for a one-way drive estimate (minutes, buffer included). Null when unknown. */
export function driveEffort(minutes: number | null | undefined): Effort | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null
  if (minutes <= 90) return 'low'
  if (minutes <= 180) return 'moderate'
  if (minutes <= 330) return 'high'
  return 'very-high'
}

export const EFFORT_TEXT: Record<Effort, string> = {
  low: 'Low · an easy day trip',
  moderate: 'Moderate · a full day out',
  high: 'High · a long day each way',
  'very-high': 'Very high · plan an overnight',
}
