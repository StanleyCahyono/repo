#!/usr/bin/env node
/**
 * Download every catalog resort's lifts and downhill pistes from OpenStreetMap (Overpass API) ONCE and bundle them
 * as compact snapshots in src/assets/osm/<id>.json, so the resort maps draw offline. Run when the catalog changes:
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-osm-snapshots.mjs            # all resorts missing a snapshot
 *   NODE_USE_ENV_PROXY=1 node scripts/build-osm-snapshots.mjs --force zermatt alta
 *   node scripts/build-osm-snapshots.mjs --encode      # convert older snapshots to encoded polylines (offline)
 *   NODE_USE_ENV_PROXY=1 node scripts/build-osm-snapshots.mjs --places   # add town/village/peak/station labels
 *
 * Area: the OpenStreetMap ski areas (landuse=winter_sports) within 3 km of the resort's coordinate, as one bounding
 * box (padded 400 m); without any, a radius around the coordinate sized from the catalog's piste km. Lines are
 * simplified (≈4 m) and stored as encoded polylines (5 decimals). Data © OpenStreetMap contributors, ODbL.
 * Writes src/assets/osm/index.ts (the registry the app imports).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'assets', 'osm')
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
const UA = 'Piste/0.1 (personal ski planner; one-off snapshot build)'
const LIFTS = 'cable_car|gondola|mixed_lift|chair_lift|drag_lift|t-bar|j-bar|platter|rope_tow|magic_carpet|zip_line'
// Only the tags the map reads (every non-lift line is a downhill piste, so piste:type is implied).
const KEEP_TAGS = ['name', 'ref', 'aerialway', 'aerialway:occupancy', 'piste:difficulty', 'piste:name']

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(q) {
  let last
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: 'data=' + encodeURIComponent(q) })
      if (res.status === 429 || res.status === 504 || res.status === 503) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return await res.json()
    } catch (e) {
      last = e
      await sleep(5000 * (attempt + 1))
    }
  }
  throw last
}

// Douglas–Peucker on [lon, lat] (local equirectangular metres).
function simplify(pts, tolM = 4) {
  if (pts.length < 3) return pts
  const k = Math.cos((pts[0][1] * Math.PI) / 180) * 111320
  const xy = pts.map(([lo, la]) => [lo * k, la * 110540])
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0, idx = -1
    const [ax, ay] = xy[a], [bx, by] = xy[b]
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + bx * ay - by * ax) / len
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max > tolM && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i]).map(([lo, la]) => [+lo.toFixed(5), +la.toFixed(5)])
}

// Google encoded polyline (precision 5): about a third of the size of JSON coordinate pairs.
function encode(pts) {
  let out = ''
  let pLat = 0
  let pLon = 0
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lon, lat] of pts) {
    const la = Math.round(lat * 1e5)
    const lo = Math.round(lon * 1e5)
    enc(la - pLat)
    enc(lo - pLon)
    pLat = la
    pLon = lo
  }
  return out
}

const pick = (tags = {}) => Object.fromEntries(KEEP_TAGS.filter((k) => tags[k] != null).map((k) => [k, tags[k]]))

async function snapshot(r) {
  const { lat, lon } = r.location
  // 1. Ski areas near the coordinate → bounding box.
  const sa = await overpass(`[out:json][timeout:90];(way(around:3000,${lat},${lon})[landuse=winter_sports];relation(around:3000,${lat},${lon})[landuse=winter_sports];);out bb tags;`)
  let s = 90, w = 180, n = -90, e = -180
  for (const el of sa.elements ?? []) {
    const b = el.bounds
    if (!b) continue
    s = Math.min(s, b.minlat)
    w = Math.min(w, b.minlon)
    n = Math.max(n, b.maxlat)
    e = Math.max(e, b.maxlon)
  }
  let area
  if (n > s) {
    const pad = 0.0036
    // Guard against a huge landuse polygon (whole valleys): cap at ~40 km.
    if (n - s > 0.36 || e - w > 0.5) area = `(around:12000,${lat},${lon})`
    else area = `(${(s - pad).toFixed(5)},${(w - pad).toFixed(5)},${(n + pad).toFixed(5)},${(e + pad).toFixed(5)})`
  } else {
    const km = r.terrain?.pisteKm ?? null
    const radius = km == null ? 5000 : Math.min(15000, Math.max(3000, Math.round(Math.sqrt(km) * 900)))
    area = `(around:${radius},${lat},${lon})`
  }
  // 2. Lifts and downhill pistes (ways and route relations) with geometry.
  const q = `[out:json][timeout:180];(way[aerialway~"^(${LIFTS})$"]${area};way["piste:type"="downhill"]${area};relation["piste:type"="downhill"]${area};);out tags geom;`
  const data = await overpass(q)
  const elements = []
  const seen = new Set()
  for (const el of data.elements ?? []) {
    if (el.type === 'way' && el.geometry) {
      if (el.tags?.area === 'yes' || (el.tags?.['piste:type'] === 'downhill' && el.geometry.length > 3 && el.geometry[0].lat === el.geometry.at(-1).lat && el.geometry[0].lon === el.geometry.at(-1).lon && !el.tags?.aerialway)) continue
      seen.add(el.id)
      elements.push({ tags: pick(el.tags), c: simplify(el.geometry.map((g) => [g.lon, g.lat])) })
    }
  }
  // Route relations: their member ways carry the relation's name and difficulty (member ways often have no tags).
  for (const el of data.elements ?? []) {
    if (el.type !== 'relation' || !el.members) continue
    for (const m of el.members) {
      if (m.type !== 'way' || !m.geometry || seen.has(m.ref) || m.role === 'outer' || m.role === 'inner') continue
      seen.add(m.ref)
      elements.push({ tags: pick(el.tags), c: simplify(m.geometry.filter(Boolean).map((g) => [g.lon, g.lat])) })
    }
  }
  return {
    fetched: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL)',
    osmTimestamp: data.osm3s?.timestamp_osm_base ?? null,
    area,
    elements: elements.filter((x) => x.c.length >= 2).map(({ c, ...x }) => ({ ...x, p: encode(c) })),
  }
}

function writeIndex() {
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()
  const id = (f) => f.replace(/\.json$/, '')
  const ident = (f) => '_' + id(f).replace(/[^a-z0-9]/gi, '_')
  const src = `// GENERATED by scripts/build-osm-snapshots.mjs — OpenStreetMap lifts & pistes bundled per resort (ODbL).
import type { OsmSnapshot } from './types'
${files.map((f) => `import ${ident(f)} from './${f}'`).join('\n')}

export const OSM_SNAPSHOTS: Record<string, OsmSnapshot> = {
${files.map((f) => `  '${id(f)}': ${ident(f)} as unknown as OsmSnapshot,`).join('\n')}
}
`
  fs.writeFileSync(path.join(OUT, 'index.ts'), src)
  console.log(`index.ts: ${files.length} snapshots`)
}

// --places: add named places to existing snapshots so the map can label where things are — towns and villages
// (the area padded ~3 km, so the base village is included), named peaks and lift stations. Keeps `name:en` when set.
// Stored as places: [{ n, en?, k, ll: [lon, lat], e? }] with k = city|town|village|hamlet|peak|station.
async function places(snap) {
  const m = snap.area.match(/^\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)$/)
  const pad = 0.027
  const near = m
    ? `(${(+m[1] - pad).toFixed(5)},${(+m[2] - pad * 1.4).toFixed(5)},${(+m[3] + pad).toFixed(5)},${(+m[4] + pad * 1.4).toFixed(5)})`
    : snap.area.replace(/around:(\d+)/, (_, d) => `around:${+d + 3000}`)
  const q = `[out:json][timeout:120];(node[place~"^(city|town|village|hamlet)$"][name]${near};node[natural=peak][name]${snap.area};node[aerialway=station][name]${snap.area};);out body;`
  const data = await overpass(q)
  const out = []
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {}
    const k = t.place ?? (t.natural === 'peak' ? 'peak' : 'station')
    const ele = Number.parseFloat(t.ele)
    out.push({ n: t.name, ...(t['name:en'] && t['name:en'] !== t.name ? { en: t['name:en'] } : {}), k, ll: [+el.lon.toFixed(5), +el.lat.toFixed(5)], ...(Number.isFinite(ele) ? { e: Math.round(ele) } : {}) })
  }
  const RANK = { city: 0, town: 1, village: 2, hamlet: 3, peak: 4, station: 5 }
  out.sort((a, b) => RANK[a.k] - RANK[b.k] || (b.e ?? 0) - (a.e ?? 0))
  // Keep the map legible: every city/town, then up to 40 villages, 25 hamlets, 30 peaks and 60 stations.
  const CAP = { city: 99, town: 99, village: 40, hamlet: 25, peak: 30, station: 60 }
  const count = {}
  return out.filter((p) => (count[p.k] = (count[p.k] ?? 0) + 1) <= CAP[p.k])
}

if (args.includes('--places')) {
  const failedPlaces = []
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '')
    if (only.length && !only.includes(id)) continue
    const file = path.join(OUT, f)
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (snap.places && !force) continue
    try {
      snap.places = await places(snap)
      fs.writeFileSync(file, JSON.stringify(snap))
      console.log(`${id}: ${snap.places.length} places (${snap.places.filter((p) => p.k === 'town' || p.k === 'city' || p.k === 'village').map((p) => p.n).slice(0, 6).join(', ')})`)
    } catch (e) {
      failedPlaces.push(id)
      console.warn(`${id}: places FAILED ${e.message}`)
    }
    await sleep(1200)
  }
  if (failedPlaces.length) console.warn(`Places failed: ${failedPlaces.join(' ')}`)
  process.exit(0)
}

// --encode: rewrite existing snapshots into the current compact format (encoded polylines, used tags only) offline.
if (args.includes('--encode')) {
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.json'))) {
    const snap = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
    snap.elements = snap.elements.map(({ c, geometry, p, tags }) => ({
      tags: pick(tags),
      p: p ?? encode(c ?? (geometry ?? []).map((g) => [g.lon, g.lat])),
    }))
    fs.writeFileSync(path.join(OUT, f), JSON.stringify(snap))
  }
  writeIndex()
  process.exit(0)
}

const resorts = fs
  .readdirSync(path.join(ROOT, 'catalog', 'resorts'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'resorts', f), 'utf8')))
  .filter((r) => !only.length || only.includes(r.id))

fs.mkdirSync(OUT, { recursive: true })
const failed = []
for (const r of resorts) {
  const file = path.join(OUT, `${r.id}.json`)
  if (fs.existsSync(file) && !force) continue
  try {
    const snap = await snapshot(r)
    fs.writeFileSync(file, JSON.stringify(snap))
    const lifts = snap.elements.filter((x) => x.tags.aerialway).length
    console.log(`${r.id}: ${lifts} lifts, ${snap.elements.length - lifts} piste lines, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
  } catch (e) {
    failed.push(r.id)
    console.warn(`${r.id}: FAILED ${e.message}`)
  }
  await sleep(1500)
}
writeIndex()
if (failed.length) console.warn(`Failed: ${failed.join(' ')}`)
