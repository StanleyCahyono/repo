#!/usr/bin/env node
/**
 * Download real road routes ONCE from the OSRM routing service (OpenStreetMap data) and bundle them in
 * src/assets/routes.json, so "Ride there" draws drives along the road instead of a straight line, offline:
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-drive-routes.mjs             # all legs
 *   NODE_USE_ENV_PROXY=1 node scripts/build-drive-routes.mjs --catalog   # also write the routed minutes/km into the catalog
 *
 * Legs: home (Ithaca, the default home) → every North American resort within ~1,300 km or with a recorded drive;
 * home → every origin airport; every gateway airport → each resort it serves. Lines are simplified (~25 m) and stored
 * as encoded polylines (precision 5). Durations are OSRM's free-flow car times (no traffic, no winter conditions).
 * Keys: "home>resort:<id>", "home>apt:<IATA>", "apt:<IATA>>resort:<id>".
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAT = path.join(ROOT, 'catalog')
const OUT = path.join(ROOT, 'src', 'assets', 'routes.json')
const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const UA = 'Piste/0.1 (personal ski planner; one-off route build)'
const HOME = { name: 'Ithaca, NY', lat: 42.4406, lon: -76.4966 }
const args = process.argv.slice(2)
const writeCatalog = args.includes('--catalog')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const today = new Date().toISOString().slice(0, 10)

function decode(str) {
  const out = []
  let i = 0, lat = 0, lon = 0
  const next = () => {
    let shift = 0, result = 0, b
    do {
      b = str.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < str.length) {
    lat += next()
    lon += next()
    out.push([lon / 1e5, lat / 1e5])
  }
  return out
}

function encode(pts) {
  let out = '', pLat = 0, pLon = 0
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lon, lat] of pts) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5)
    enc(la - pLat)
    enc(lo - pLon)
    pLat = la
    pLon = lo
  }
  return out
}

function simplify(pts, tolM = 25) {
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
  return pts.filter((_, i) => keep[i])
}

const gcKm = (a, b) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function route(from, to) {
  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline`
  let last
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      if (d.code !== 'Ok' || !d.routes?.length) throw Object.assign(new Error(d.code ?? 'no route'), { final: true })
      const r = d.routes[0]
      return { p: encode(simplify(decode(r.geometry))), km: Math.round(r.distance / 100) / 10, min: Math.round(r.duration / 60) }
    } catch (e) {
      last = e
      if (e.final) break
      await sleep(3000 * (i + 1))
    }
  }
  throw last
}

const airports = JSON.parse(fs.readFileSync(path.join(CAT, 'airports.json'), 'utf8'))
const aptBy = new Map(airports.airports.map((a) => [a.iata, a]))
const resortFiles = fs.readdirSync(path.join(CAT, 'resorts')).filter((f) => f.endsWith('.json'))
const resorts = resortFiles.map((f) => ({ file: path.join(CAT, 'resorts', f), raw: fs.readFileSync(path.join(CAT, 'resorts', f), 'utf8') })).map((x) => ({ ...x, r: JSON.parse(x.raw) }))

const legs = []
for (const { r } of resorts) {
  const at = { lat: r.location.lat, lon: r.location.lon }
  if (r.travel?.driveFromIthaca || (['US', 'CA'].includes(r.country) && gcKm(HOME, at) < 1300)) legs.push({ key: `home>resort:${r.id}`, from: HOME, to: at })
  for (const a of r.travel?.airports ?? []) {
    const apt = aptBy.get(a.iata)
    if (apt) legs.push({ key: `apt:${a.iata}>resort:${r.id}`, from: { lat: apt.lat, lon: apt.lon }, to: at })
  }
}
for (const a of airports.airports.filter((x) => x.role === 'origin')) legs.push({ key: `home>apt:${a.iata}`, from: HOME, to: { lat: a.lat, lon: a.lon } })

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { routes: {} }
const routes = { ...prev.routes }
const failed = []
for (const leg of legs) {
  if (routes[leg.key] && !args.includes('--force')) continue
  try {
    routes[leg.key] = await route(leg.from, leg.to)
    console.log(`${leg.key}: ${routes[leg.key].km} km, ${routes[leg.key].min} min`)
  } catch (e) {
    failed.push(leg.key)
    console.warn(`${leg.key}: FAILED ${e.message}`)
  }
  await sleep(1100)
}
fs.writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), source: 'OSRM routing service, OpenStreetMap contributors (ODbL)', home: HOME, routes }))
console.log(`routes.json: ${Object.keys(routes).length} routes, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`)

if (writeCatalog) {
  const src = (key) => ({
    url: 'https://project-osrm.org/',
    verification: 'api',
    checkedOn: today,
    note: `OSRM routing service (OpenStreetMap data), free-flow car time — no traffic or winter conditions (${key})`,
  })
  for (const x of resorts) {
    const r = x.r
    let changed = false
    const h = routes[`home>resort:${r.id}`]
    if (h && r.travel) {
      r.travel.driveFromIthaca = { minutes: h.min, km: h.km, basis: `Road route from Ithaca, NY: ${h.km} km, about ${h.min} min without traffic (OSRM).`, source: src('home → resort') }
      changed = true
    }
    for (const a of r.travel?.airports ?? []) {
      const t = routes[`apt:${a.iata}>resort:${r.id}`]
      if (!t) continue
      a.minutes = t.min
      a.km = t.km
      a.basis = `Road route from ${a.iata}: ${t.km} km, about ${t.min} min without traffic (OSRM).${r.id === 'zermatt' ? ' Zermatt is car-free: park in Täsch and take the shuttle train.' : ''}`
      a.source = src(`${a.iata} → resort`)
      changed = true
    }
    if (changed) fs.writeFileSync(x.file, JSON.stringify(r, null, 2) + '\n')
  }
  for (const a of airports.airports.filter((x) => x.role === 'origin')) {
    const t = routes[`home>apt:${a.iata}`]
    if (!t) continue
    a.driveFromHome = { minutes: t.min, km: t.km, basis: `Road route from downtown Ithaca: ${t.km} km, about ${t.min} min without traffic (OSRM).`, source: src(`home → ${a.iata}`) }
  }
  fs.writeFileSync(path.join(CAT, 'airports.json'), JSON.stringify(airports, null, 2) + '\n')
}
if (failed.length) console.warn(`Failed: ${failed.join(' ')}`)
