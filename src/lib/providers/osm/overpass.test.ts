/**
 * Overpass adapter against hand-made fixtures in the documented Overpass JSON format (the build environment has no
 * network): a North American resort (Alta, next to Snowbird) and an Alps resort (Ski Arlberg, whose ski area is not in
 * Overpass' area index, so the bounding-box fallback runs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { groupRuns, runCountsText } from '@/lib/domain/lifts'
import { fakeHttp, json, type FakeCall } from '../test-helpers'
import { readSkiAreaExtract } from './extract'
import {
  BBOX_MARGIN_M,
  SITE_BBOX_MARGIN_M,
  chooseSites,
  createOverpassProvider,
  durationMinutes,
  expandBBox,
  extractSkiArea,
  haversineM,
  intTag,
  lineLengthM,
  nameTokens,
  pointsBBox,
  sitesBBox,
  type SkiSite,
} from './overpass'

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8'))
const queryOf = (c: FakeCall) => decodeURIComponent((c.body ?? '').replace(/^data=/, ''))
const kindOf = (q: string) => (q.includes('out tags bb') ? 'sites' : q.includes('map_to_area') ? 'area' : q.includes('[bbox:') ? 'bbox' : 'other')

/** Equirectangular approximation — an independent check of the haversine lengths (within 0.5% at these distances). */
function approxM(points: [number, number][]): number {
  let t = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const x = ((b[1] - a[1]) * Math.PI) / 180 * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180)
    const y = ((b[0] - a[0]) * Math.PI) / 180
    t += Math.sqrt(x * x + y * y) * 6_371_008.8
  }
  return t
}

const ALTA = {
  resortId: 'alta',
  names: ['Alta Ski Area', 'Alta'],
  country: 'US',
  points: [
    { lat: 40.5885, lon: -111.638 },
    { lat: 40.57, lon: -111.628 },
  ],
}
const ARLBERG = {
  resortId: 'ski-arlberg',
  names: ['Ski Arlberg', 'Ski Arlberg'],
  country: 'AT',
  points: [
    { lat: 47.129, lon: 10.264 },
    { lat: 47.158, lon: 10.213 },
  ],
}

describe('geometry', () => {
  it('measures lines in metres, breaks at missing vertices, and says unknown rather than 0', () => {
    expect(haversineM({ lat: 40, lon: -111 }, { lat: 40.001, lon: -111 })).toBeCloseTo(111.19, 1)
    expect(lineLengthM(null)).toBeNull()
    expect(lineLengthM([{ lat: 40, lon: -111 }])).toBeNull()
    expect(lineLengthM([{ lat: 40, lon: -111 }, null, { lat: 41, lon: -111 }])).toBeNull()
    const a = { lat: 47.1297, lon: 10.2655 }
    const b = { lat: 47.1398, lon: 10.2425 }
    const c = { lat: 47.1433, lon: 10.233 }
    expect(lineLengthM([a, b, null, c])).toBe(Math.round(haversineM(a, b)))
    expect(lineLengthM([a, b, c])).toBe(Math.round(haversineM(a, b) + haversineM(b, c)))
  })

  it('grows boxes by a margin in metres', () => {
    const b = expandBBox(pointsBBox([{ lat: 47, lon: 10 }]), 1000)
    expect(haversineM({ lat: b[0], lon: 10 }, { lat: b[2], lon: 10 })).toBeCloseTo(2000, -1)
    expect(haversineM({ lat: 47, lon: b[1] }, { lat: 47, lon: b[3] })).toBeCloseTo(2000, -1)
  })
})

describe('tags', () => {
  it('reads capacities written in several conventions, and nothing else', () => {
    expect(intTag('2400', 1, 30000)).toBe(2400)
    expect(intTag('2,400', 1, 30000)).toBe(2400)
    expect(intTag('2.400', 1, 30000)).toBe(2400)
    expect(intTag('1 050', 1, 30000)).toBe(1050)
    expect(intTag('2400 p/h', 1, 30000)).toBe(2400)
    expect(intTag('about 2000', 1, 30000)).toBeNull()
    expect(intTag('2.4', 1, 30000)).toBeNull()
    expect(intTag('0', 1, 30000)).toBeNull()
    expect(intTag(undefined, 1, 30000)).toBeNull()
  })

  it('reads ride times in minutes', () => {
    expect(durationMinutes('7')).toBe(7)
    expect(durationMinutes('7.5')).toBe(7.5)
    expect(durationMinutes('4:30')).toBe(4.5)
    expect(durationMinutes('0:04:30')).toBe(4.5)
    expect(durationMinutes('PT5M30S')).toBe(5.5)
    expect(durationMinutes('6 min')).toBe(6)
    expect(durationMinutes('slow')).toBeNull()
    expect(durationMinutes('0')).toBeNull()
  })
})

describe('choosing the resort’s own ski area', () => {
  const site = (name: string | null, b: [number, number, number, number]): SkiSite => ({
    type: 'way',
    id: Math.round(b[0] * 1000),
    name,
    names: name ? [name] : [],
    bounds: { minlat: b[0], minlon: b[1], maxlat: b[2], maxlon: b[3] },
  })
  const alta = site('Alta Ski Area', [40.5703, -111.6531, 40.5977, -111.6112])
  const snowbird = site('Snowbird', [40.548, -111.6804, 40.5921, -111.6352])

  it('prefers names that share a distinctive word — a neighbour holding the base point is not taken', () => {
    expect(nameTokens('Skigebiet St. Anton am Arlberg')).toEqual(['anton', 'arlberg'])
    expect(nameTokens('Mount Snow Resort')).toEqual([])
    expect(chooseSites([snowbird, alta], ALTA.points, ALTA.names)).toEqual([alta])
  })

  it('falls back to the areas holding a weather point, then to the nearest', () => {
    expect(chooseSites([snowbird, alta], ALTA.points, ['Mount Snow'])).toEqual([snowbird, alta])
    const far = site('Elsewhere', [40.6, -111.6, 40.61, -111.59])
    const farther = site('Farther', [40.7, -111.6, 40.71, -111.59])
    expect(chooseSites([farther, far], ALTA.points, ['Mount Snow'])).toEqual([far])
    expect(chooseSites([], ALTA.points, ALTA.names)).toEqual([])
  })
})

describe('Overpass provider — North American resort (Alta)', () => {
  it('reads lifts and runs inside the resort’s own ski area', async () => {
    const h = fakeHttp((call) => {
      const q = queryOf(call)
      return json(fixture(kindOf(q) === 'sites' ? 'overpass-alta-sites.json' : 'overpass-alta-area.json'))
    })
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea(ALTA)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // Two polite requests: a form-encoded POST (no preflight in a browser) to the Overpass endpoint.
    expect(h.calls.map((c) => [c.method, c.url, kindOf(queryOf(c))])).toEqual([
      ['POST', 'https://overpass-api.de/api/interpreter', 'sites'],
      ['POST', 'https://overpass-api.de/api/interpreter', 'area'],
    ])
    expect(h.calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(queryOf(h.calls[0])).toContain('(around:2500,40.58850,-111.63800,40.57000,-111.62800)')
    expect(queryOf(h.calls[1])).toContain('way(id:25712340);')
    expect(queryOf(h.calls[1])).not.toContain('3451876')
    expect(h.sleeps.some((ms) => ms >= 1900)).toBe(true)

    const d = res.data
    expect(d).toMatchObject({ v: 1, method: 'area', bbox: null, osmTimestamp: '2026-09-29T21:14:03Z', areaPistes: 1 })
    expect(d.areas).toEqual([{ osm: 'way/25712340', name: 'Alta Ski Area' }])

    // Lifts: disused ones and stations are not lifts.
    expect(d.lifts.map((l) => [l.type, l.name ?? l.ref])).toEqual([
      ['chair_lift', 'Collins'],
      ['chair_lift', 'Sugarloaf'],
      ['chair_lift', 'Sunnyside'],
      ['chair_lift', 'Supreme'],
      ['chair_lift', 'Wildcat'],
      ['rope_tow', 'Transfer Tow'],
      ['magic_carpet', 'MC'],
    ])
    const collins = d.lifts.find((l) => l.name === 'Collins')!
    expect(collins).toMatchObject({ osm: 'way/30135240', capacityPerHour: 1800, occupancy: 3, durationMin: 7 })
    const collinsLine: [number, number][] = [
      [40.5901, -111.6377],
      [40.5824, -111.6393],
      [40.578, -111.6402],
    ]
    expect(Math.abs(collins.lengthM! - approxM(collinsLine)) / approxM(collinsLine)).toBeLessThan(0.005)
    expect(d.lifts.find((l) => l.name === 'Wildcat')?.durationMin).toBe(7.5)
    expect(d.lifts.find((l) => l.name === 'Sugarloaf')?.capacityPerHour).toBe(2400)
    expect(d.lifts.find((l) => l.name === 'Sunnyside')?.capacityPerHour).toBeNull()

    // Runs: named ways grouped, route relations as one run, unnamed ways counted as segments.
    const byName = new Map(d.runs.map((r) => [r.name, r]))
    expect([...byName.keys()].sort()).toEqual(['Ballroom', 'Collins Face', 'Corkscrew', "Devil's Castle", 'High Rustler', 'Mambo', 'Sidewinder', 'West Rustler'])
    const rustler = byName.get('High Rustler')!
    expect(rustler).toMatchObject({ difficulty: 'expert', segments: 2 })
    expect(rustler.lengthM).toBe(
      Math.round(haversineM({ lat: 40.5795, lon: -111.6448 }, { lat: 40.583, lon: -111.644 })) + Math.round(haversineM({ lat: 40.583, lon: -111.644 }, { lat: 40.5862, lon: -111.6425 })),
    )
    expect(byName.get("Devil's Castle")).toMatchObject({ osm: 'relation/50300001', difficulty: 'expert', segments: 2 })
    // No difficulty on the relation: every member states 'advanced', so it is advanced — its own members' tags.
    expect(byName.get('West Rustler')).toMatchObject({ osm: 'relation/50300002', difficulty: 'advanced' })
    expect(byName.get('Collins Face')?.grooming).toBe('mogul')
    // The relation members (40200012, 40200013) are not counted again as unnamed segments.
    expect(d.unnamed).toEqual([
      { difficulty: 'easy', segments: 1, lengthM: expect.any(Number) },
      { difficulty: 'advanced', segments: 1, lengthM: expect.any(Number) },
    ])
    expect(runCountsText(groupRuns(d, 'north-america'))).toBe('1 green circle · 2 blue square · 3 black diamond · 2 double black diamond')

    // Community data, stated as such; the extract round-trips through its stored form.
    expect(res.provenance).toMatchObject({ kind: 'manual', provider: 'OpenStreetMap contributors (ODbL)', verification: 'unverified', sourceUrl: 'https://www.openstreetmap.org/way/25712340' })
    expect(res.provenance.publishedAt).toBe('2026-09-29T21:14:03Z')
    expect(res.capabilities.missing).toContain('live lift status')
    expect(res.fetches).toHaveLength(2)
    expect(res.fetches.every((f) => f.ok && f.httpStatus === 200)).toBe(true)
    expect(readSkiAreaExtract(JSON.parse(JSON.stringify({ skiArea: d, requests: 2 })))).toEqual(d)
    expect(readSkiAreaExtract({ skiArea: { ...d, v: 2 } })).toBeNull()
    expect(readSkiAreaExtract(null)).toBeNull()
  })
})

describe('Overpass provider — Alps resort (Ski Arlberg)', () => {
  it('falls back to the ski area’s bounding box when its area is not indexed, and reads European difficulties', async () => {
    const h = fakeHttp((call) => {
      const k = kindOf(queryOf(call))
      return json(fixture(k === 'sites' ? 'overpass-arlberg-sites.json' : k === 'area' ? 'overpass-arlberg-area-empty.json' : 'overpass-arlberg-bbox.json'))
    })
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea(ARLBERG)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(h.calls.map((c) => kindOf(queryOf(c)))).toEqual(['sites', 'area', 'bbox'])
    // Sonnenkopf is another ski area: only St. Anton's (it names Arlberg) is searched.
    expect(queryOf(h.calls[1])).toContain('relation(id:1234567);')
    expect(queryOf(h.calls[1])).not.toContain('7654321')
    const expected = expandBBox(sitesBBox([{ bounds: { minlat: 47.1201, minlon: 10.1905, maxlat: 47.1702, maxlon: 10.2803 } }]), SITE_BBOX_MARGIN_M)
    expect(queryOf(h.calls[2])).toContain(`[bbox:${expected.map((v) => v.toFixed(5)).join(',')}]`)

    const d = res.data
    expect(d).toMatchObject({ method: 'bbox', bbox: expected, areaPistes: 1, areas: [{ osm: 'relation/1234567', name: 'Skigebiet St. Anton am Arlberg' }] })
    expect(d.lifts.map((l) => [l.type, l.name ?? l.ref])).toEqual([
      ['cable_car', 'Vallugabahn I'],
      ['cable_car', 'Vallugabahn II'],
      ['gondola', 'Galzigbahn'],
      ['chair_lift', 'Kapall'],
      ['funicular', 'Arlberg funicular (fixture)'],
      ['t-bar', 'Übungslift Nasserein'],
      ['platter', 'K1'],
    ])
    expect(d.lifts.find((l) => l.name === 'Galzigbahn')).toMatchObject({ capacityPerHour: 2400, occupancy: 8, durationMin: 4.5 })
    expect(d.lifts.find((l) => l.name === 'Vallugabahn I')?.capacityPerHour).toBe(1050)
    expect(d.lifts.find((l) => l.name === 'Kapall')?.durationMin).toBe(5.5)

    expect(d.runs.find((r) => r.name === 'Kandahar')).toMatchObject({ ref: '14', difficulty: 'advanced', segments: 2 })
    expect(d.runs.find((r) => r.ref === '2')).toMatchObject({ name: null, difficulty: 'easy' })
    expect(d.runs.find((r) => r.name === 'Schindlerkar')).toMatchObject({ difficulty: 'freeride', grooming: 'backcountry' })
    expect(d.runs.some((r) => r.name === 'Ski Arlberg')).toBe(false)
    expect(d.unnamed).toEqual([{ difficulty: 'intermediate', segments: 2, lengthM: expect.any(Number) }])
    const groups = groupRuns(d, 'europe')
    expect(groups.map((g) => g.style.label)).toEqual(['Green', 'Blue', 'Red', 'Black', 'Freeride / itinerary'])
    expect(runCountsText(groups)).toBe('1 green · 2 blue · 1 red · 1 black · 2 freeride / itinerary')
    expect(res.capabilities.limitations.join(' ')).toMatch(/bounding box/)
    expect(res.fetches).toHaveLength(3)
  })

  it('searches a box around the weather points when no ski area is mapped nearby', async () => {
    const h = fakeHttp((call) => json(kindOf(queryOf(call)) === 'sites' ? { osm3s: {}, elements: [] } : fixture('overpass-arlberg-bbox.json')))
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea(ARLBERG)
    expect(h.calls.map((c) => kindOf(queryOf(c)))).toEqual(['sites', 'bbox'])
    const box = expandBBox(pointsBBox(ARLBERG.points), BBOX_MARGIN_M)
    expect(queryOf(h.calls[1])).toContain(`[bbox:${box.map((v) => v.toFixed(5)).join(',')}]`)
    expect(res.ok && res.data).toMatchObject({ method: 'bbox', areas: [] })
    expect(res.ok && res.provenance.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/#map=14\//)
  })
})

describe('extractSkiArea', () => {
  const line = (lat: number) => [
    { lat, lon: 10 },
    { lat: lat + 0.001, lon: 10 },
  ]
  const meta = { method: 'area' as const, areas: [], bbox: null, osmTimestamp: null }

  it('counts an unnamed route relation as unnamed sections, never as a run, and its member ways once', () => {
    const d = extractSkiArea(
      [
        {
          type: 'relation',
          id: 1,
          tags: { type: 'route', route: 'piste', 'piste:type': 'downhill', 'piste:difficulty': 'easy' },
          members: [
            { type: 'way', ref: 11, role: '', geometry: line(47) },
            { type: 'way', ref: 12, role: '', geometry: line(47.001) },
          ],
        },
        { type: 'way', id: 11, tags: { 'piste:type': 'downhill', 'piste:difficulty': 'easy' }, geometry: line(47) },
      ],
      meta,
    )
    expect(d.runs).toEqual([])
    expect(d.unnamed).toEqual([{ difficulty: 'easy', segments: 2, lengthM: 2 * Math.round(haversineM(line(47)[0], line(47)[1])) }])
  })

  it('keeps a member way with a name of its own as its own run', () => {
    const d = extractSkiArea(
      [
        { type: 'relation', id: 2, tags: { type: 'route', 'piste:type': 'downhill', 'piste:difficulty': 'intermediate', name: 'Race course' }, members: [{ type: 'way', ref: 21, role: '', geometry: line(47) }] },
        { type: 'way', id: 21, tags: { 'piste:type': 'downhill', 'piste:difficulty': 'advanced', name: 'Steilhang' }, geometry: line(47) },
        { type: 'way', id: 22, tags: { 'piste:type': 'downhill', name: 'No difficulty mapped' }, geometry: line(47.01) },
      ],
      meta,
    )
    expect(d.runs.map((r) => [r.name, r.difficulty])).toEqual([
      ['Race course', 'intermediate'],
      ['Steilhang', 'advanced'],
      ['No difficulty mapped', 'unknown'],
    ])
  })
})

describe('Overpass provider — failures', () => {
  it('backs off after a rate limit: one retry, then nothing is requested for a minute', async () => {
    const h = fakeHttp(() => new Response('Too Many Requests', { status: 429 }))
    const p = createOverpassProvider({ http: h.client })
    const first = await p.fetchSkiArea(ALTA)
    expect(first).toMatchObject({ ok: false, errorKind: 'rate-limited', retriable: true })
    expect(h.calls).toHaveLength(2)
    expect(!first.ok && first.fetches.every((f) => f.ok === false && f.httpStatus === 429)).toBe(true)

    const second = await p.fetchSkiArea(ALTA)
    expect(second).toMatchObject({ ok: false, errorKind: 'rate-limited' })
    expect(!second.ok && second.fetches).toEqual([])
    expect(h.calls).toHaveLength(2)

    h.advance(61_000)
    await p.fetchSkiArea(ALTA)
    expect(h.calls.length).toBeGreaterThan(2)
  })

  it('treats a server-side timeout remark (HTTP 200) as a failure, never as an empty ski area', async () => {
    const h = fakeHttp(() => json(fixture('overpass-remark-timeout.json')))
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea(ALTA)
    expect(res).toMatchObject({ ok: false, errorKind: 'timeout', retriable: true })
    expect(!res.ok && res.error).toMatch(/Query timed out/)
    expect(!res.ok && res.fetches[0]).toMatchObject({ ok: false, httpStatus: 200 })
  })

  it('reports an unexpected response as a parse error', async () => {
    const h = fakeHttp(() => json({ hello: 'world' }))
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea(ALTA)
    expect(res).toMatchObject({ ok: false, errorKind: 'parse', retriable: false })
  })

  it('needs somewhere to look', async () => {
    const h = fakeHttp(() => json({ elements: [] }))
    const res = await createOverpassProvider({ http: h.client }).fetchSkiArea({ ...ALTA, points: [{ lat: Number.NaN, lon: 0 }] })
    expect(res).toMatchObject({ ok: false, errorKind: 'unsupported' })
    expect(h.calls).toHaveLength(0)
  })
})
