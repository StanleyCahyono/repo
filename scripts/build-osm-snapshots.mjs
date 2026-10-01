#!/usr/bin/env node
/**
 * Download every catalog resort's lifts and downhill pistes from OpenStreetMap (Overpass API) ONCE and bundle them
 * as compact snapshots in src/assets/osm/<id>.json, so the resort maps draw offline. Run when the catalog changes:
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-osm-snapshots.mjs            # all resorts missing a snapshot
 *   NODE_USE_ENV_PROXY=1 node scripts/build-osm-snapshots.mjs --force zermatt alta
 *
 * Area: the OpenStreetMap ski areas (landuse=winter_sports) within 3 km of the resort's coordinate, as one bounding
 * box (padded 400 m); without any, a radius around the coordinate sized from the catalog's piste km. Lines are
 * simplified (≈4 m) and rounded to 5 decimals. Data © OpenStreetMap contributors, ODbL.
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
const KEEP_TAGS = ['name', 'ref', 'aerialway', 'aerialway:occupancy', 'aerialway:capacity', 'piste:type', 'piste:difficulty', 'piste:name', 'piste:grooming', 'area']

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
      elements.push({ id: `w${el.id}`, tags: pick(el.tags), c: simplify(el.geometry.map((g) => [g.lon, g.lat])) })
    }
  }
  // Route relations: their member ways carry the relation's name and difficulty (member ways often have no tags).
  for (const el of data.elements ?? []) {
    if (el.type !== 'relation' || !el.members) continue
    for (const m of el.members) {
      if (m.type !== 'way' || !m.geometry || seen.has(m.ref) || m.role === 'outer' || m.role === 'inner') continue
      seen.add(m.ref)
      elements.push({ id: `r${el.id}w${m.ref}`, tags: pick({ ...el.tags, type: undefined }), c: simplify(m.geometry.filter(Boolean).map((g) => [g.lon, g.lat])) })
    }
  }
  return {
    fetched: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL)',
    osmTimestamp: data.osm3s?.timestamp_osm_base ?? null,
    area,
    elements: elements.filter((x) => x.c.length >= 2),
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
