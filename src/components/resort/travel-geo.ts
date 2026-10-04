/**
 * Geometry for the Getting there route map (server side): the bundled road routes (OSRM over OpenStreetMap, in
 * src/assets/routes.json) for the legs that are driven, Natural Earth land, borders and city labels around them.
 * Everything is cropped to the map's frame so only what is drawn is sent to the page.
 *
 * A leg without a bundled route is drawn as a straight dashed line and labelled as such — never as a road.
 */
import 'server-only'
import ROUTES from '@/assets/routes.json'
import LAND from '@/assets/geo/world-land.json'
import BORDERS from '@/assets/geo/world-borders.json'
import CITIES from '@/assets/geo/world-cities.json'
import { decodePolyline } from '@/assets/osm/decode'

type LonLat = [number, number]

export interface RouteLeg {
  id: string
  /** Where the leg starts: an airport code or 'home'. */
  from: { key: string; name: string; lon: number; lat: number }
  /** Road geometry ([lon, lat]); two points when no road route is bundled (drawn dashed, labelled straight). */
  coords: LonLat[]
  road: boolean
  /** Road distance and routing estimate (OSRM, no traffic), when bundled. */
  km: number | null
  min: number | null
}

export interface RouteMapData {
  legs: RouteLeg[]
  resort: { name: string; lon: number; lat: number }
  /** [west, south, east, north] of everything that must be in view. */
  bbox: [number, number, number, number]
  /** Flat [lon, lat, lon, lat, …] rings / lines, cropped to the frame. */
  land: number[][]
  borders: number[][]
  /** Natural Earth places in the frame, biggest first. */
  cities: { name: string; lon: number; lat: number; pop: number }[]
  routeSource: string
}

interface RoutesFile {
  source: string
  routes: Record<string, { p: string; km?: number; min?: number }>
}
interface CitiesFile {
  cities: { n: string; ll: LonLat; pop?: number }[]
}

const R = ROUTES as unknown as RoutesFile

/** Douglas–Peucker in degrees: keeps the road's shape at map scale with a fraction of the points. */
function simplify(pts: LonLat[], tol: number): LonLat[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-12
    let best = -1
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > best) {
        best = d
        idx = i
      }
    }
    if (best > tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Sutherland–Hodgman clip of a ring to a box (rings stay closed shapes; good enough for a backdrop). */
function clipRing(flat: number[], [w, s, e, n]: [number, number, number, number]): number[] {
  let pts: LonLat[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]])
  const edges: [(p: LonLat) => boolean, (a: LonLat, b: LonLat) => LonLat][] = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ]
  for (const [inside, cut] of edges) {
    if (!pts.length) break
    const out: LonLat[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const prev = pts[(i + pts.length - 1) % pts.length]
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur))
        out.push(cur)
      } else if (inside(prev)) out.push(cut(prev, cur))
    }
    pts = out
  }
  return pts.flatMap(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])
}

const boxOf = (flat: number[]): [number, number, number, number] => {
  let w = 180
  let s = 90
  let e = -180
  let n = -90
  for (let i = 0; i + 1 < flat.length; i += 2) {
    w = Math.min(w, flat[i])
    e = Math.max(e, flat[i])
    s = Math.min(s, flat[i + 1])
    n = Math.max(n, flat[i + 1])
  }
  return [w, s, e, n]
}
const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

/**
 * The route map for a resort: driven legs from home (drive resorts) or from each gateway airport (fly resorts).
 * Returns null when there is nothing to draw.
 */
export function routeMapData(input: {
  resortId: string
  resort: { name: string; lon: number; lat: number }
  home: { name: string; lon: number; lat: number }
  airports: { iata: string; name: string; lon: number; lat: number }[]
  fly: boolean
}): RouteMapData | null {
  const { resort } = input
  const starts = input.fly
    ? input.airports.map((a) => ({ key: a.iata, name: a.name, lon: a.lon, lat: a.lat, route: `apt:${a.iata}>resort:${input.resortId}` }))
    : [{ key: 'home', name: input.home.name, lon: input.home.lon, lat: input.home.lat, route: `home>resort:${input.resortId}` }]
  if (!starts.length) return null
  const legs: RouteLeg[] = starts.map((st) => {
    const r = R.routes[st.route]
    const decoded = r ? decodePolyline(r.p) : null
    const road = !!decoded && decoded.length > 1
    return {
      id: st.route,
      from: { key: st.key, name: st.name, lon: st.lon, lat: st.lat },
      coords: road ? decoded! : [[st.lon, st.lat], [resort.lon, resort.lat]],
      road,
      km: road && typeof r?.km === 'number' ? r.km : null,
      min: road && typeof r?.min === 'number' ? r.min : null,
    }
  })
  let w = resort.lon
  let s = resort.lat
  let e = resort.lon
  let n = resort.lat
  for (const l of legs)
    for (const [lon, lat] of [...l.coords, [l.from.lon, l.from.lat] as LonLat]) {
      w = Math.min(w, lon)
      e = Math.max(e, lon)
      s = Math.min(s, lat)
      n = Math.max(n, lat)
    }
  const span = Math.max(e - w, n - s, 0.2)
  const tol = span / 900
  for (const l of legs) if (l.road) l.coords = simplify(l.coords, tol).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])
  // Generous margin so the backdrop fills any aspect ratio the page lays the map out at.
  const m = Math.max(span * 0.9, 0.6)
  const crop: [number, number, number, number] = [w - m * 4, s - m * 1.2, e + m * 4, n + m * 1.2]
  const land = (LAND as number[][]).filter((r) => overlaps(boxOf(r), crop)).map((r) => clipRing(r, crop)).filter((r) => r.length >= 6)
  const borders = (BORDERS as number[][])
    .filter((r) => overlaps(boxOf(r), crop))
    .map((r) => r.map((v) => Math.round(v * 100) / 100))
    .filter((r) => r.length >= 4)
  const cities = (CITIES as unknown as CitiesFile).cities
    .filter((c) => c.ll[0] >= crop[0] && c.ll[0] <= crop[2] && c.ll[1] >= crop[1] && c.ll[1] <= crop[3])
    .sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0))
    .slice(0, 40)
    .map((c) => ({ name: c.n, lon: c.ll[0], lat: c.ll[1], pop: c.pop ?? 0 }))
  return { legs, resort, bbox: [w, s, e, n], land, borders, cities, routeSource: R.source }
}
