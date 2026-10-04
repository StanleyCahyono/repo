/**
 * Geography for the trip page's route map (components/trips/trip-map): where home, the airports and the resort are,
 * the road each ground leg follows, the towns and cities around them for labels, and the coastlines and borders
 * for a fly-in trip.
 *
 * - Roads come only from the bundled OSRM routes (src/assets/routes.json, OpenStreetMap data, built once by
 *   scripts/build-drive-routes.mjs). A leg without a stored route draws no line at all — a drive is never shown as
 *   a straight line or an invented path.
 * - Labels: Natural Earth populated places (src/assets/geo/world-cities.json) plus the resort's own OpenStreetMap
 *   towns and villages when its snapshot carries them. The client places them without overlaps.
 * - Everything is filtered to the map's area here, so the page ships a few kilobytes, not the world.
 */
import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { inArray } from 'drizzle-orm'
import type { DataCtx } from '@/lib/data/core'
import * as s from '@/lib/db/schema'
import { OSM_SNAPSHOTS } from '@/assets/osm'
import { decodePolyline } from '@/assets/osm/decode'
import worldCities from '@/assets/geo/world-cities.json'
import worldLand from '@/assets/geo/world-land.json'
import worldBorders from '@/assets/geo/world-borders.json'
import type { LonLat, MapCity, MapNode, TripMapGeo } from '@/components/trips/trip-map'

type StoredRoute = { p: string; km?: number; min?: number }

let routesFile: Promise<Record<string, StoredRoute> | null> | undefined
/** The bundled road routes, or null where the file is not available (it is optional; the map then draws no roads). */
function storedRoutes(): Promise<Record<string, StoredRoute> | null> {
  routesFile ??= readFile(path.join(process.cwd(), 'src', 'assets', 'routes.json'), 'utf8')
    .then((txt) => {
      const j = JSON.parse(txt) as { routes?: Record<string, StoredRoute> }
      return j.routes ?? null
    })
    .catch(() => null)
  return routesFile
}

async function road(key: string): Promise<LonLat[] | null> {
  const r = (await storedRoutes())?.[key]
  if (!r?.p) return null
  try {
    const pts = decodePolyline(r.p)
    return pts.length >= 2 ? pts : null
  } catch {
    return null
  }
}

interface Box {
  w: number
  s: number
  e: number
  n: number
}

function boxOf(points: readonly LonLat[], padDeg: number, padFrac: number): Box {
  const lons = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  const w = Math.min(...lons)
  const e = Math.max(...lons)
  const so = Math.min(...lats)
  const n = Math.max(...lats)
  const px = Math.max(padDeg, (e - w) * padFrac)
  const py = Math.max(padDeg, (n - so) * padFrac)
  return { w: w - px, e: e + px, s: so - py, n: n + py }
}

const inBox = (b: Box, lon: number, lat: number) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n

/** Rings / lines (flat lon,lat arrays) that touch the box, thinned to roughly `step` degrees between points. */
function clipRings(rings: readonly number[][], b: Box, step: number): number[][] {
  const out: number[][] = []
  for (const r of rings) {
    let touches = false
    for (let i = 0; i < r.length; i += 2) {
      if (inBox(b, r[i], r[i + 1])) {
        touches = true
        break
      }
    }
    if (!touches) continue
    const thin: number[] = [r[0], r[1]]
    let lx = r[0]
    let ly = r[1]
    for (let i = 2; i < r.length - 2; i += 2) {
      if (Math.abs(r[i] - lx) + Math.abs(r[i + 1] - ly) >= step) {
        thin.push(r[i], r[i + 1])
        lx = r[i]
        ly = r[i + 1]
      }
    }
    thin.push(r[r.length - 2], r[r.length - 1])
    if (thin.length >= 6) out.push(thin.map((v) => Math.round(v * 100) / 100))
  }
  return out
}

const CITIES = (worldCities as unknown as { cities: { n: string; ll: [number, number]; z: number; pop: number }[] }).cities

function citiesIn(b: Box, resortIds: readonly string[], limit: number): MapCity[] {
  const out: MapCity[] = []
  const seen = new Set<string>()
  // The resort's own towns and villages (OpenStreetMap), when its snapshot carries them: best for a short drive.
  for (const id of resortIds) {
    for (const p of OSM_SNAPSHOTS[id]?.places ?? []) {
      if (p.k !== 'city' && p.k !== 'town' && p.k !== 'village') continue
      if (!inBox(b, p.ll[0], p.ll[1])) continue
      const n = p.en ?? p.n
      if (seen.has(n)) continue
      seen.add(n)
      out.push({ n, ll: p.ll, rank: p.k === 'city' ? 3 : p.k === 'town' ? 6 : 8 })
    }
  }
  for (const c of CITIES) {
    if (!inBox(b, c.ll[0], c.ll[1]) || seen.has(c.n)) continue
    seen.add(c.n)
    out.push({ n: c.n, ll: c.ll, rank: c.z })
  }
  return out.sort((a, c) => a.rank - c.rank).slice(0, limit)
}

const km = (a: LonLat, b: LonLat) => {
  const dLat = (b[1] - a[1]) * (Math.PI / 180)
  const dLon = (b[0] - a[0]) * (Math.PI / 180) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return 6371 * Math.hypot(dLat, dLon)
}

/** Up to `limit` notable cities (Natural Earth zoom ≤ 7) within `maxKm` of any anchor, nearest first. */
function nearbyCities(anchors: readonly LonLat[], skip: readonly string[], limit: number, maxKm: number): LonLat[] {
  const names = new Set(skip.map((x) => x.toLowerCase()))
  return CITIES.filter((c) => c.z <= 7 && !names.has(c.n.toLowerCase()))
    .map((c) => ({ ll: c.ll as LonLat, d: Math.min(...anchors.map((a) => km(a, c.ll))) }))
    .filter((c) => c.d <= maxKm && c.d > 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((c) => c.ll)
}

export interface RouteGeoInput {
  home: { name: string; lat: number; lon: number }
  resort: { id: string; name: string; lat: number; lon: number }
  origin: string | null
  dest: string | null
}

export async function routeGeo(ctx: DataCtx, input: RouteGeoInput): Promise<TripMapGeo> {
  const iatas = [input.origin, input.dest].filter((x): x is string => !!x)
  const rows = iatas.length ? await ctx.db.select({ iata: s.airports.iata, name: s.airports.name, city: s.airports.city, lat: s.airports.lat, lon: s.airports.lon }).from(s.airports).where(inArray(s.airports.iata, iatas)) : []
  const apt = (iata: string | null): MapNode | null => {
    const a = rows.find((r) => r.iata === iata)
    // "Syracuse, NY" → "Syracuse": the code and the city are enough on a map.
    return a ? { id: `apt:${a.iata}`, kind: 'airport', ll: [a.lon, a.lat], label: a.iata, sub: (a.city ?? a.name).split(',')[0] } : null
  }
  const home: MapNode = { id: 'home', kind: 'home', ll: [input.home.lon, input.home.lat], label: input.home.name.split(',')[0], sub: 'Home' }
  const resort: MapNode = { id: `resort:${input.resort.id}`, kind: 'resort', ll: [input.resort.lon, input.resort.lat], label: input.resort.name, sub: 'Resort' }
  const origin = apt(input.origin)
  const dest = apt(input.dest)
  const [drive, toOrigin, fromDest] = await Promise.all([
    road(`home>resort:${input.resort.id}`),
    origin ? road(`home>apt:${origin.label}`) : Promise.resolve(null),
    dest ? road(`apt:${dest.label}>resort:${input.resort.id}`) : Promise.resolve(null),
  ])

  // Drive: towns around home and the resort — the nearest few cities are kept in view so a short drive still has
  // named places around it. Fly: cities along the way, plus coastlines and borders for context.
  const nearby = nearbyCities([home.ll, resort.ll], [home.label, resort.label], 3, 80)
  const drivePts: LonLat[] = [home.ll, resort.ll, ...(drive ?? []), ...nearby]
  const flyPts: LonLat[] = [home.ll, resort.ll, ...(origin ? [origin.ll] : []), ...(dest ? [dest.ll] : [])]
  const driveBox = boxOf(drivePts, 0.9, 0.6)
  const flyBox = boxOf(flyPts, 1.5, 0.35)
  const flySpan = Math.max(flyBox.e - flyBox.w, flyBox.n - flyBox.s)
  const hasFly = !!(origin && dest)
  return {
    home,
    resort,
    origin,
    dest,
    roads: { drive, toOrigin, fromDest },
    context: { drive: nearby },
    cities: { drive: citiesIn(driveBox, [input.resort.id], 40), fly: hasFly ? citiesIn(flyBox, [input.resort.id], 60) : [] },
    land: hasFly ? clipRings(worldLand as unknown as number[][], flyBox, flySpan / 220) : [],
    borders: hasFly ? clipRings(worldBorders as unknown as number[][], flyBox, flySpan / 220) : [],
  }
}
