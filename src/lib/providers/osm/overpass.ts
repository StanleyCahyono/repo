/**
 * Lifts and runs from OpenStreetMap, through the Overpass API (https://wiki.openstreetmap.org/wiki/Overpass_API).
 *
 * What it reads: aerial lifts (`aerialway` = cable_car, gondola, mixed_lift, chair_lift, drag_lift, t-bar, j-bar,
 * platter, rope_tow, magic_carpet), funiculars (`railway=funicular`) and downhill pistes (`piste:type=downhill` ways and
 * route relations) of the resort's ski area — names, refs, types, capacity, seats, ride time, difficulty, grooming.
 * Lengths are computed here from the returned geometry (map distance along the line), then the geometry is dropped:
 * Piste keeps a compact extract only. The data is community-mapped (© OpenStreetMap contributors, ODbL): it may be
 * incomplete or out of date, and it never says whether a lift or run is open.
 *
 * Finding the ski area (two small POST requests, a third when needed):
 * 1. `landuse=winter_sports` ways and relations within SITE_RADIUS_M of the line from Piste's base point to its summit
 *    point, with names and bounds;
 * 2. the resort's own ones are kept (`chooseSites`: names that share a distinctive word with the resort's name — so a
 *    neighbour such as Snowbird is not read as part of Alta — else those whose bounds hold a weather point, else the
 *    nearest), turned into areas (`map_to_area`), and the lifts and runs inside them are read with geometry;
 * 3. fallback, a bounding box: the chosen ski areas' bounds (when their area is not in Overpass' area index, nothing is
 *    found inside), or the weather points plus BBOX_MARGIN_M when no ski area is mapped nearby. A box can take in a
 *    neighbouring area's lifts, and the extract says which method was used.
 *
 * Politeness: requests are paced per host (http.ts), identified by the User-Agent on the server (the single-file build
 * sends the browser's own), retried at most once, and after HTTP 429/504 or a server-side timeout nothing is asked for
 * a minute. CORS: the requests are "simple" (a form-encoded POST without custom headers in a browser) and overpass-api.de
 * answers with `Access-Control-Allow-Origin: *`, so the single-file build can call it from file://.
 */
import { z } from 'zod'
import {
  LIFT_TYPES,
  OSM_NOTE,
  OSM_PROVIDER,
  PISTE_DIFFICULTIES,
  SKI_AREA_EXTRACT_VERSION,
  osmMapUrl,
  osmUrl,
  type LiftType,
  type MappedLift,
  type MappedRun,
  type RunDifficulty,
  type SkiAreaExtract,
  type UnnamedSegments,
} from '@/lib/domain/lifts'
import { provenance } from '@/lib/domain/types'
import { defaultHttp, type HttpClient } from '../http'
import { caps, describeIssues, fail, failFromHttp } from '../result'
import type { ProviderResult, SkiAreaProvider, SkiAreaRequest, SourceFetch } from '../types'

export const OSM_ADAPTER_ID = 'osm-overpass'
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
/** Ski areas are looked for within this distance of the base–summit line. */
export const SITE_RADIUS_M = 2500
/** Fallback box around the weather points when no ski area is mapped nearby. */
export const BBOX_MARGIN_M = 1500
/** Margin around a chosen ski area's bounds when its area is not in the index. */
export const SITE_BBOX_MARGIN_M = 300
/** After a 429/504 or a server-side timeout, ask nothing for this long. */
export const BUSY_PAUSE_MS = 60_000
const MAX_BYTES = 24 * 1024 * 1024

export type LatLon = { lat: number; lon: number }
/** [south, west, north, east] */
export type BBox = [number, number, number, number]

// ---------------------------------------------------------------------------------------------------------------------
// Response format (Overpass JSON, https://dev.overpass-api.de/output_formats.html#json)

const Pt = z.object({ lat: z.number(), lon: z.number() })
const Geometry = z.array(Pt.nullable())
const Bounds = z.object({ minlat: z.number(), minlon: z.number(), maxlat: z.number(), maxlon: z.number() })

const ElementSchema = z.object({
  type: z.string(),
  id: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
  bounds: Bounds.optional(),
  geometry: Geometry.optional(),
  members: z.array(z.object({ type: z.string(), ref: z.number(), role: z.string().optional(), geometry: Geometry.optional() })).optional(),
})
export type OsmElement = z.infer<typeof ElementSchema>

const ResponseSchema = z.object({
  osm3s: z.object({ timestamp_osm_base: z.string().optional() }).optional(),
  elements: z.array(ElementSchema),
  remark: z.string().optional(),
})
type OverpassResponse = z.infer<typeof ResponseSchema>

// ---------------------------------------------------------------------------------------------------------------------
// Geometry

const EARTH_M = 6_371_008.8
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Length of a mapped line in whole metres (map distance). A `null` vertex (outside a clipped output) breaks the line;
 * fewer than two usable vertices means unknown (null), never 0.
 */
export function lineLengthM(points: readonly (LatLon | null)[] | null | undefined): number | null {
  if (!points || points.length < 2) return null
  let total = 0
  let segments = 0
  let prev: LatLon | null = null
  for (const p of points) {
    if (!p) {
      prev = null
      continue
    }
    if (prev) {
      total += haversineM(prev, p)
      segments++
    }
    prev = p
  }
  return segments ? Math.round(total) : null
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5
const clampLat = (v: number) => Math.max(-90, Math.min(90, v))

export function pointsBBox(points: readonly LatLon[]): BBox {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)]
}

/** Grow a box by `marginM` on every side. */
export function expandBBox(b: BBox, marginM: number): BBox {
  const dLat = marginM / 111_320
  const mid = rad((b[0] + b[2]) / 2)
  const dLon = marginM / (111_320 * Math.max(0.1, Math.cos(mid)))
  return [round5(clampLat(b[0] - dLat)), round5(b[1] - dLon), round5(clampLat(b[2] + dLat)), round5(b[3] + dLon)]
}

type SiteBounds = z.infer<typeof Bounds>

const inBounds = (p: LatLon, b: SiteBounds) => p.lat >= b.minlat && p.lat <= b.maxlat && p.lon >= b.minlon && p.lon <= b.maxlon

/** Distance from a point to a box (0 inside). */
export function boundsDistanceM(p: LatLon, b: SiteBounds): number {
  const nearest = { lat: Math.min(Math.max(p.lat, b.minlat), b.maxlat), lon: Math.min(Math.max(p.lon, b.minlon), b.maxlon) }
  return haversineM(p, nearest)
}

// ---------------------------------------------------------------------------------------------------------------------
// Queries (Overpass QL)

const c5 = (v: number) => v.toFixed(5)
const LIFT_VALUES = LIFT_TYPES.filter((t) => t !== 'funicular').join('|')

/**
 * The lifts-and-runs body for a scope ('(area.a)', or '' under a global [bbox]). Ways print tags and geometry only
 * (`out tags geom`, no node ids); route relations need their member list, so they print `out body geom` (each member
 * way with its geometry).
 */
const skiFeatures = (scope: string) =>
  `(way${scope}["aerialway"~"^(${LIFT_VALUES})$"];way${scope}["railway"="funicular"];)->.lifts;` +
  `way${scope}["piste:type"="downhill"]->.runways;relation${scope}["piste:type"="downhill"]->.runrels;` +
  '.lifts out tags geom;.runways out tags geom;.runrels out body geom;'

/** Ski areas (landuse=winter_sports) near the base–summit line (a polyline for `around` when there are two points). */
export function sitesQuery(points: readonly LatLon[], radiusM = SITE_RADIUS_M): string {
  const line = points.map((p) => `${c5(p.lat)},${c5(p.lon)}`).join(',')
  return `[out:json][timeout:25];(way["landuse"="winter_sports"](around:${radiusM},${line});relation["landuse"="winter_sports"](around:${radiusM},${line}););out tags bb;`
}

/** Lifts and runs inside the chosen ski areas. */
export function areaQuery(sites: readonly Pick<SkiSite, 'type' | 'id'>[]): string {
  const ways = sites.filter((s) => s.type === 'way').map((s) => s.id)
  const rels = sites.filter((s) => s.type === 'relation').map((s) => s.id)
  const pick = `${ways.length ? `way(id:${ways.join(',')});` : ''}${rels.length ? `relation(id:${rels.join(',')});` : ''}`
  return `[out:json][timeout:90];(${pick})->.sites;.sites map_to_area->.a;${skiFeatures('(area.a)')}`
}

/** Lifts and runs inside a bounding box. */
export function bboxQuery(b: BBox): string {
  return `[out:json][timeout:90][bbox:${b.map(c5).join(',')}];${skiFeatures('')}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing the resort's own ski areas

export interface SkiSite {
  type: 'way' | 'relation'
  id: number
  name: string | null
  /** Every name it is mapped under (name, name:en, alt_name…). */
  names: string[]
  bounds: SiteBounds
}

const NAME_KEYS = ['name', 'name:en', 'official_name', 'alt_name', 'short_name', 'loc_name', 'name:de', 'name:fr', 'name:it', 'name:ja']

const clean = (s: string | null | undefined): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim()
  return t ? t : null
}

export function parseSites(elements: readonly OsmElement[]): SkiSite[] {
  const out: SkiSite[] = []
  const seen = new Set<string>()
  for (const e of elements) {
    if ((e.type !== 'way' && e.type !== 'relation') || e.tags?.landuse !== 'winter_sports' || !e.bounds) continue
    const key = `${e.type}/${e.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const t = e.tags
    const names = [...new Set(NAME_KEYS.flatMap((k) => (t[k] ?? '').split(';')).map((n) => clean(n)).filter((n): n is string => !!n))]
    out.push({ type: e.type, id: e.id, name: clean(t.name) ?? clean(t['name:en']), names, bounds: e.bounds })
  }
  return out
}

/** Words that say nothing about which ski area a name means. */
const GENERIC = new Set(
  (
    'ski skiing area areas resort resorts mountain mountains mount mtn the and of at on de du des la le les di del della da am im an der die das und en el los las ' +
    'snow park village station domaine skiable skigebiet skiarena arena valley peak peaks basin bowl world center centre club hill hills lift lifts sport sports ' +
    'winter zone piste pistes alpine alp alps region ridge slope slopes bergbahnen bahnen stazione sciistica comprensorio estacion esqui glacier'
  ).split(' '),
)

/** Distinctive words of a name: lower case, accents removed, 3+ letters, generic words dropped. */
export function nameTokens(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !GENERIC.has(t))
}

/**
 * The resort's own ski areas among those found: the ones whose names share a distinctive word with the resort's names
 * (plus unnamed ones holding a weather point); else those whose bounds hold a weather point; else the nearest one.
 */
export function chooseSites<T extends Pick<SkiSite, 'names' | 'bounds'>>(sites: readonly T[], points: readonly LatLon[], resortNames: readonly string[]): T[] {
  if (!sites.length) return []
  const wanted = new Set(resortNames.flatMap(nameTokens))
  const holdsPoint = (s: T) => points.some((p) => inBounds(p, s.bounds))
  const named = wanted.size ? sites.filter((s) => s.names.some((n) => nameTokens(n).some((t) => wanted.has(t)))) : []
  if (named.length) return [...named, ...sites.filter((s) => !s.names.length && holdsPoint(s) && !named.includes(s))]
  const holding = sites.filter(holdsPoint)
  if (holding.length) return holding
  let best = sites[0]
  let bestM = Infinity
  for (const s of sites) {
    const d = Math.min(...points.map((p) => boundsDistanceM(p, s.bounds)))
    if (d < bestM) [best, bestM] = [s, d]
  }
  return [best]
}

/** The union of ski areas' bounds. */
export function sitesBBox(sites: readonly Pick<SkiSite, 'bounds'>[]): BBox {
  return [Math.min(...sites.map((s) => s.bounds.minlat)), Math.min(...sites.map((s) => s.bounds.minlon)), Math.max(...sites.map((s) => s.bounds.maxlat)), Math.max(...sites.map((s) => s.bounds.maxlon))]
}

// ---------------------------------------------------------------------------------------------------------------------
// Tags → lifts and runs

const LIFT_TAG: Record<string, LiftType> = Object.fromEntries(LIFT_TYPES.filter((t) => t !== 'funicular').map((t) => [t, t]))
const DIFFICULTY = new Set<string>(PISTE_DIFFICULTIES)

function liftTypeOf(t: Record<string, string>): LiftType | null {
  const a = t.aerialway?.trim()
  if (a && Object.hasOwn(LIFT_TAG, a)) return LIFT_TAG[a]
  if (t.railway === 'funicular') return 'funicular'
  return null
}

/** Disused, abandoned or demolished lifts and runs are not listed. */
function isRetired(t: Record<string, string>): boolean {
  return ['disused', 'abandoned', 'demolished', 'razed', 'piste:abandoned'].some((k) => t[k] === 'yes')
}

export function difficultyOf(v: string | undefined): RunDifficulty {
  const d = v?.trim().toLowerCase()
  return d && DIFFICULTY.has(d) ? (d as RunDifficulty) : 'unknown'
}

/** A whole number from a tag such as "2400", "2 400", "2,400" or "2.400"; null when out of range or unreadable. */
export function intTag(v: string | undefined, min: number, max: number): number | null {
  const m = v?.trim().match(/^~?\s*(\d{1,3}(?:[ ,.'’  ]\d{3})+|\d+)(?:\s*[a-z/]*)?$/i)
  if (!m) return null
  const n = Number(m[1].replace(/[^\d]/g, ''))
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** `aerialway:duration` in minutes: "7", "7.5", "4:30" (mm:ss), "0:04:30", "PT4M30S"; null otherwise. */
export function durationMinutes(v: string | undefined): number | null {
  const s = v?.trim()
  if (!s) return null
  let min: number | null = null
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d+(?:\.\d+)?)(?:\s*min)?$/i))) min = Number(m[1])
  else if ((m = s.match(/^(\d{1,3}):([0-5]\d)$/))) min = Number(m[1]) + Number(m[2]) / 60
  else if ((m = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/))) min = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60
  else if ((m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)) && (m[1] || m[2] || m[3])) min = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60
  return min !== null && min > 0 && min <= 180 ? Math.round(min * 10) / 10 : null
}

const sameName = (a: string | null, b: string | null) => !!a && !!b && a.localeCompare(b, 'en', { sensitivity: 'base' }) === 0

function isClosed(g: OsmElement['geometry']): boolean {
  if (!g || g.length < 4) return false
  const a = g[0]
  const b = g[g.length - 1]
  return !!a && !!b && a.lat === b.lat && a.lon === b.lon
}

const DIFFICULTY_ORDER: readonly RunDifficulty[] = [...PISTE_DIFFICULTIES, 'unknown']
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export interface ExtractMeta {
  method: SkiAreaExtract['method']
  areas: SkiAreaExtract['areas']
  bbox: SkiAreaExtract['bbox']
  osmTimestamp: string | null
}

/**
 * Lifts and runs from Overpass elements (pure). Named piste ways are grouped into runs by name/ref and difficulty; a
 * route relation is one run (its unnamed member ways, and members with its own name, are not listed again); unnamed
 * ways are counted per difficulty as segments. Pistes mapped only as outlines (areas) are counted, not listed.
 */
export function extractSkiArea(elements: readonly OsmElement[], meta: ExtractMeta): SkiAreaExtract {
  const seen = new Set<string>()
  const lifts: MappedLift[] = []
  const relations: OsmElement[] = []
  const ways: OsmElement[] = []
  let areaPistes = 0
  for (const e of elements) {
    const key = `${e.type}/${e.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const t = e.tags ?? {}
    if (isRetired(t)) continue
    const liftType = e.type === 'way' ? liftTypeOf(t) : null
    if (liftType) {
      lifts.push({
        osm: key,
        name: clean(t.name) ?? clean(t['name:en']),
        ref: clean(t.ref),
        type: liftType,
        lengthM: lineLengthM(e.geometry),
        capacityPerHour: intTag(t['aerialway:capacity'], 1, 30_000),
        occupancy: intTag(t['aerialway:occupancy'], 1, 250),
        durationMin: durationMinutes(t['aerialway:duration']),
      })
      continue
    }
    if (t['piste:type'] !== 'downhill') continue
    if (e.type === 'relation') {
      if (t.type === 'multipolygon') areaPistes++
      else if (!t.type || t.type === 'route') relations.push(e)
    } else if (e.type === 'way') {
      if (t.area === 'yes' || (t.area !== 'no' && isClosed(e.geometry))) areaPistes++
      else ways.push(e)
    }
  }

  // Route relations: one run each (an unnamed one only adds unnamed sections, like an unnamed way).
  const wayById = new Map(ways.map((w) => [w.id, w]))
  const coveredBy = new Map<number, string | null>()
  const runs: MappedRun[] = []
  const unnamed = new Map<RunDifficulty, UnnamedSegments>()
  const addUnnamed = (difficulty: RunDifficulty, segments: number, lengthM: number) => {
    const u = unnamed.get(difficulty) ?? { difficulty, segments: 0, lengthM: 0 }
    u.segments += segments
    u.lengthM += lengthM
    unnamed.set(difficulty, u)
  }
  for (const r of relations) {
    const t = r.tags ?? {}
    const name = clean(t['piste:name']) ?? clean(t.name)
    const ref = clean(t['piste:ref']) ?? clean(t.ref)
    const members = (r.members ?? []).filter((m) => m.type === 'way' && !['area', 'outer', 'inner'].includes(m.role ?? ''))
    const unique = [...new Map(members.map((m) => [m.ref, m])).values()]
    for (const m of unique) coveredBy.set(m.ref, name)
    const lengths = unique.map((m) => lineLengthM(m.geometry)).filter((x): x is number => x !== null)
    let difficulty = difficultyOf(t['piste:difficulty'])
    if (difficulty === 'unknown') {
      // Only when every member way present states the same difficulty: its own tags, not a guess.
      const own = [...new Set(unique.map((m) => wayById.get(m.ref)).filter((w): w is OsmElement => !!w).map((w) => difficultyOf(w.tags?.['piste:difficulty'])))]
      if (own.length === 1) difficulty = own[0]
    }
    const lengthM = lengths.length ? lengths.reduce((a, b) => a + b, 0) : null
    if (!name && !ref) {
      addUnnamed(difficulty, unique.length, lengthM ?? 0)
      continue
    }
    runs.push({
      osm: `relation/${r.id}`,
      name,
      ref,
      difficulty,
      grooming: clean(t['piste:grooming']),
      lengthM,
      segments: unique.length,
    })
  }

  // Ways: named ones grouped into runs; unnamed ones counted as segments.
  const named = new Map<string, MappedRun & { groomings: Set<string> }>()
  for (const w of ways) {
    const t = w.tags ?? {}
    const name = clean(t['piste:name']) ?? clean(t.name)
    const ref = clean(t['piste:ref']) ?? clean(t.ref)
    if (coveredBy.has(w.id)) {
      const relName = coveredBy.get(w.id)!
      if ((!name && !ref) || sameName(name, relName)) continue
    }
    const difficulty = difficultyOf(t['piste:difficulty'])
    const len = lineLengthM(w.geometry)
    if (!name && !ref) {
      addUnnamed(difficulty, 1, len ?? 0)
      continue
    }
    const key = `${difficulty}|${(name ?? '').toLowerCase()}|${(ref ?? '').toLowerCase()}`
    const cur = named.get(key)
    if (cur) {
      cur.segments++
      if (len !== null) cur.lengthM = (cur.lengthM ?? 0) + len
      if (t['piste:grooming']) cur.groomings.add(t['piste:grooming'])
    } else {
      named.set(key, { osm: `way/${w.id}`, name, ref, difficulty, grooming: null, lengthM: len, segments: 1, groomings: new Set(t['piste:grooming'] ? [t['piste:grooming']] : []) })
    }
  }
  for (const { groomings, ...run } of named.values()) {
    const g = [...groomings]
    runs.push({ ...run, grooming: g.length === 1 ? g[0] : g.find((x) => x.includes('mogul')) ?? g[0] ?? null })
  }

  const byDifficulty = (a: RunDifficulty, b: RunDifficulty) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b)
  const byName = (a: { name: string | null; ref: string | null }, b: { name: string | null; ref: string | null }) => collator.compare(a.name ?? a.ref ?? '~', b.name ?? b.ref ?? '~')
  return {
    v: SKI_AREA_EXTRACT_VERSION,
    method: meta.method,
    areas: meta.areas,
    bbox: meta.bbox,
    osmTimestamp: meta.osmTimestamp,
    lifts: lifts.sort((a, b) => LIFT_TYPES.indexOf(a.type) - LIFT_TYPES.indexOf(b.type) || byName(a, b) || a.osm.localeCompare(b.osm)),
    runs: runs.sort((a, b) => byDifficulty(a.difficulty, b.difficulty) || byName(a, b) || a.osm.localeCompare(b.osm)),
    unnamed: [...unnamed.values()].sort((a, b) => byDifficulty(a.difficulty, b.difficulty)),
    areaPistes,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Provider

/** The fetch record of the last request, marked failed (the HTTP call succeeded but its content did not). */
function failLast(fetches: SourceFetch[], error: string): SourceFetch[] {
  const last = fetches[fetches.length - 1]
  return last ? [...fetches.slice(0, -1), { ...last, ok: false, error }] : fetches
}

export function createOverpassProvider(options: { http?: HttpClient; endpoint?: string } = {}): SkiAreaProvider {
  const endpoint = options.endpoint ?? OVERPASS_ENDPOINT
  const client = () => options.http ?? defaultHttp
  let busyUntil = 0

  type Asked = { ok: true; data: OverpassResponse } | { ok: false; result: ProviderResult<never> }

  async function ask(query: string, serverTimeoutS: number, fetches: SourceFetch[]): Promise<Asked> {
    const http = client()
    const res = await http.request(endpoint, {
      method: 'POST',
      // A form-encoded POST with only CORS-safelisted headers: no preflight in a browser.
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      expect: 'json',
      timeoutMs: (serverTimeoutS + 20) * 1000,
      // The query only reads, so one retry is safe; Overpass asks clients to back off, so only one.
      retries: 1,
      backoff: { baseMs: 5000, maxMs: 15_000 },
      maxBytes: MAX_BYTES,
    })
    fetches.push(res.fetch)
    if (!res.ok) {
      if (res.status === 429 || res.status === 504 || res.errorKind === 'rate-limited') busyUntil = http.env.nowMs() + Math.max(BUSY_PAUSE_MS, res.retryAfterMs ?? 0)
      return { ok: false, result: failFromHttp(res, fetches, 'Overpass API') }
    }
    const parsed = ResponseSchema.safeParse(res.data)
    if (!parsed.success) {
      const error = `Overpass API: unexpected response (${describeIssues(parsed.error.issues)})`
      return { ok: false, result: fail('parse', error, failLast(fetches, error), false) }
    }
    // A server-side failure arrives as HTTP 200 with a "remark" (and partial or no elements): never a result.
    const remark = parsed.data.remark?.trim()
    if (remark && /error|timed out|out of memory/i.test(remark)) {
      busyUntil = http.env.nowMs() + BUSY_PAUSE_MS
      const error = `Overpass API: ${remark.slice(0, 200)}`
      return { ok: false, result: fail(/timed out/i.test(remark) ? 'timeout' : 'http', error, failLast(fetches, error), true) }
    }
    return { ok: true, data: parsed.data }
  }

  return {
    id: OSM_ADAPTER_ID,
    label: 'OpenStreetMap lifts & runs (Overpass API)',
    endpoint,
    async fetchSkiArea(req: SkiAreaRequest): Promise<ProviderResult<SkiAreaExtract>> {
      const points = req.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
      if (!points.length) return fail('unsupported', 'No coordinates to search around')
      const wait = busyUntil - client().env.nowMs()
      if (wait > 0) return fail('rate-limited', `Overpass API asked Piste to slow down — nothing was requested; it tries again in about ${Math.ceil(wait / 1000)} s`)

      const fetches: SourceFetch[] = []
      const s = await ask(sitesQuery(points), 25, fetches)
      if (!s.ok) return s.result
      let osmTimestamp = s.data.osm3s?.timestamp_osm_base ?? null
      const chosen = chooseSites(parseSites(s.data.elements), points, req.names)

      let elements: OsmElement[] = []
      if (chosen.length) {
        const a = await ask(areaQuery(chosen), 90, fetches)
        if (!a.ok) return a.result
        osmTimestamp = a.data.osm3s?.timestamp_osm_base ?? osmTimestamp
        elements = a.data.elements
      }
      let bbox: BBox | null = null
      if (!elements.length) {
        // No ski area mapped nearby, or its area is not in Overpass' area index (nothing inside): a bounding box.
        bbox = chosen.length ? expandBBox(sitesBBox(chosen), SITE_BBOX_MARGIN_M) : expandBBox(pointsBBox(points), BBOX_MARGIN_M)
        const b = await ask(bboxQuery(bbox), 90, fetches)
        if (!b.ok) return b.result
        osmTimestamp = b.data.osm3s?.timestamp_osm_base ?? osmTimestamp
        elements = b.data.elements
      }

      const areas = chosen.map((c) => ({ osm: `${c.type}/${c.id}`, name: c.name }))
      const data = extractSkiArea(elements, { method: bbox ? 'bbox' : 'area', areas, bbox, osmTimestamp })
      const last = fetches[fetches.length - 1]
      const centre = bbox ? { lat: (bbox[0] + bbox[2]) / 2, lon: (bbox[1] + bbox[3]) / 2 } : points[0]
      const hasCapacity = data.lifts.some((l) => l.capacityPerHour !== null)
      return {
        ok: true,
        data,
        fetches,
        provenance: provenance({
          kind: 'manual',
          provider: OSM_PROVIDER,
          sourceUrl: areas.length ? osmUrl(areas[0].osm) : osmMapUrl(centre.lat, centre.lon),
          publishedAt: osmTimestamp,
          fetchedAt: last?.fetchedAt ?? null,
          verification: 'unverified',
          note: OSM_NOTE,
        }),
        capabilities: caps(
          ['lifts', 'lift types', 'lift lengths', 'runs', 'run difficulty', 'run lengths', ...(hasCapacity ? ['lift capacity'] : [])],
          ['live lift status', 'live run status', "today's grooming", ...(hasCapacity ? [] : ['lift capacity'])],
          [
            'Community-mapped: may be incomplete or out of date.',
            'Lengths are map distances along the mapped lines.',
            ...(bbox ? ['No usable ski-area boundary: a bounding box was searched, which can include a neighbouring area.'] : []),
          ],
        ),
      }
    },
  }
}

export const overpassProvider: SkiAreaProvider = createOverpassProvider()
