import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fakeHttp, json } from '../test-helpers'
import type { WeatherPointRequest } from '../types'
import { createNwsAlertsProvider, createNwsGridWeatherProvider, parseNwsAlerts, parseNwsGrid } from './nws'
import { distributeToHours, parseValidTime } from './nws-intervals'

const load = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))
const at = (iso: string) => Date.parse(iso)

const greekPeak: WeatherPointRequest = {
  resortId: 'greek-peak',
  pointKey: 'base',
  lat: 42.5086,
  lon: -76.146,
  elevationM: 350,
  timezone: 'America/New_York',
  country: 'US',
}

describe('NWS validTime intervals', () => {
  it('parses start/duration intervals with offsets and day components', () => {
    expect(parseValidTime('2027-01-15T06:00:00+00:00/PT6H')).toEqual({ startMs: at('2027-01-15T06:00:00Z'), endMs: at('2027-01-15T12:00:00Z') })
    expect(parseValidTime('2027-01-15T01:00:00-05:00/P1DT6H')).toEqual({ startMs: at('2027-01-15T06:00:00Z'), endMs: at('2027-01-16T12:00:00Z') })
    expect(parseValidTime('2027-01-15T06:00:00+00:00/2027-01-15T09:00:00+00:00')?.endMs).toBe(at('2027-01-15T09:00:00Z'))
    expect(parseValidTime('garbage')).toBeNull()
    expect(parseValidTime('2027-01-15T06:00:00+00:00/PT0H')).toBeNull()
  })

  it('spreads an interval total evenly over its hours and conserves the total', () => {
    const m = distributeToHours([{ validTime: '2027-01-15T06:00:00+00:00/PT6H', value: 6 }], 'sum')
    expect([...m.keys()]).toHaveLength(6)
    expect([...m.values()].every((v) => v === 1)).toBe(true)
    expect(m.get(at('2027-01-15T06:00:00Z'))).toBe(1)
    expect(m.get(at('2027-01-15T11:00:00Z'))).toBe(1)
    expect(m.has(at('2027-01-15T12:00:00Z'))).toBe(false)
  })

  it('does not double count adjacent intervals and leaves partly covered edge hours empty', () => {
    const m = distributeToHours(
      [
        { validTime: '2027-01-15T06:30:00+00:00/PT2H', value: 4 }, // 06:30–08:30
        { validTime: '2027-01-15T08:30:00+00:00/PT1H30M', value: 3 }, // 08:30–10:00
      ],
      'sum',
    )
    expect(m.get(at('2027-01-15T06:00:00Z'))).toBeNull() // only half covered → unknown, not an under-count
    expect(m.get(at('2027-01-15T07:00:00Z'))).toBe(2)
    expect(m.get(at('2027-01-15T08:00:00Z'))).toBe(2) // 1 (first half) + 1 (second half)
    expect(m.get(at('2027-01-15T09:00:00Z'))).toBe(2)
  })

  it('repeats instantaneous values and keeps nulls null', () => {
    const m = distributeToHours(
      [
        { validTime: '2027-01-15T06:00:00+00:00/PT2H', value: -5 },
        { validTime: '2027-01-15T08:00:00+00:00/PT1H', value: null },
      ],
      'instant',
    )
    expect(m.get(at('2027-01-15T06:00:00Z'))).toBe(-5)
    expect(m.get(at('2027-01-15T07:00:00Z'))).toBe(-5)
    expect(m.get(at('2027-01-15T08:00:00Z'))).toBeNull()
  })
})

describe('NWS gridpoint parsing', () => {
  it('converts uom units, distributes snowfall per hour and reports what NWS cannot supply', () => {
    const r = parseNwsGrid(load('nws-griddata.json'))
    if (!r.ok) throw new Error(r.error)
    const byTime = new Map(r.value.hourly.map((h) => [h.validTime, h]))
    // snowfallAmount is new-snow depth: 30.48 mm (1.2 in) over PT6H → 0.508 cm per hour, total conserved.
    expect(byTime.get('2027-01-15T12:00:00.000Z')!.snowfallCm).toBe(0.508)
    const total = r.value.hourly.reduce((s, h) => s + (h.snowfallCm ?? 0), 0)
    expect(total).toBeCloseTo(3.048, 6)
    // null source values stay null (the 18:00–24:00 snowfall interval).
    expect(byTime.get('2027-01-15T19:00:00.000Z')?.snowfallCm ?? null).toBeNull()
    expect(byTime.get('2027-01-15T14:00:00.000Z')!.temperatureC).toBeCloseTo(-3.8889, 4)
    expect(byTime.get('2027-01-15T15:00:00.000Z')!.windKmh).toBe(18.52)
    expect(r.value.missing).toEqual(expect.arrayContaining(['rainMm', 'freezingLevelM', 'snowDepthM', 'weatherCode', 'isDay', 'visibilityM']))
    expect(r.value.supplied).toEqual(expect.arrayContaining(['snowfallCm', 'temperatureC', 'gustKmh']))
    expect(r.value.updateTime).toBe('2027-01-15T09:41:12.000Z')
    expect(r.value.grid.elevationM).toBe(399.9)
    expect(r.value.grid.lat).toBeCloseTo(42.507, 2)
  })

  it('treats an unknown uom as missing rather than guessing', () => {
    const g = load('nws-griddata.json')
    g.properties.snowfallAmount.uom = 'wmoUnit:furlongs'
    const r = parseNwsGrid(g)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.missing).toContain('snowfallCm')
    expect(r.value.hourly.every((h) => h.snowfallCm === null)).toBe(true)
  })
})

describe('NWS gridpoint provider', () => {
  const routes = (gridUrl?: string) => (call: { url: string }) => {
    if (call.url.startsWith('https://api.weather.gov/points/')) {
      const p = load('nws-points.json')
      if (gridUrl) p.properties.forecastGridData = gridUrl
      return json(p)
    }
    if (call.url === 'https://api.weather.gov/gridpoints/BGM/42,61') return json(load('nws-griddata.json'))
    return json({}, { status: 404 })
  }

  it('follows points → forecastGridData with geo+json and a following-hour series', async () => {
    const h = fakeHttp(routes(), { nowIso: '2027-01-15T11:00:00.000Z' })
    const res = await createNwsGridWeatherProvider({ http: h.client }).fetchForecast(greekPeak)
    if (!res.ok) throw new Error(res.error)
    expect(h.calls.map((c) => c.url)).toEqual(['https://api.weather.gov/points/42.5086,-76.146', 'https://api.weather.gov/gridpoints/BGM/42,61'])
    expect(h.calls[0].headers.accept).toBe('application/geo+json')
    expect(h.calls[0].headers['user-agent']).toContain('Piste/0.1')
    expect(res.data.intervalSemantics).toBe('following-hour')
    expect(res.data.modelRunAt).toBe('2027-01-15T09:41:12.000Z')
    expect(res.data.kind).toBe('modeled')
    expect(res.fetches).toHaveLength(2)
  })

  it('refuses to follow a grid URL off api.weather.gov', async () => {
    const h = fakeHttp(routes('http://169.254.169.254/latest/meta-data'))
    const res = await createNwsGridWeatherProvider({ http: h.client }).fetchForecast(greekPeak)
    expect(res.ok).toBe(false)
    expect(h.calls).toHaveLength(1)
  })

  it('does not call the network outside the US', async () => {
    const h = fakeHttp(routes())
    const provider = createNwsGridWeatherProvider({ http: h.client })
    const arlberg = { ...greekPeak, country: 'AT', lat: 47.13, lon: 10.27 }
    expect(provider.supports(arlberg)).toBe(false)
    const res = await provider.fetchForecast(arlberg)
    expect(res.ok === false && res.errorKind).toBe('unsupported')
    expect(h.calls).toHaveLength(0)
  })
})

describe('NWS alerts', () => {
  it('keeps actual alerts, normalises instants to UTC and drops test messages', () => {
    const r = parseNwsAlerts(load('nws-alerts.json'))
    if (!r.ok) throw new Error(r.error)
    expect(r.alerts).toHaveLength(1)
    expect(r.dropped).toBe(1)
    expect(r.alerts[0]).toMatchObject({
      id: 'urn:oid:2.49.0.1.840.0.aaaa.001.1',
      event: 'Winter Weather Advisory',
      severity: 'Moderate',
      onset: '2027-01-15T12:00:00.000Z',
      ends: '2027-01-16T12:00:00.000Z',
      expires: '2027-01-16T00:00:00.000Z',
      url: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.aaaa.001.1',
    })
  })

  it('queries the point with geo+json and returns official provenance', async () => {
    const h = fakeHttp(() => json(load('nws-alerts.json')))
    const res = await createNwsAlertsProvider({ http: h.client }).fetchActiveAlerts({ lat: 42.5086, lon: -76.146, country: 'US' })
    if (!res.ok) throw new Error(res.error)
    expect(h.calls[0].url).toBe('https://api.weather.gov/alerts/active?point=42.5086,-76.146')
    expect(res.provenance.kind).toBe('official')
    expect(res.capabilities.limitations.join(' ')).toMatch(/1 test\/exercise/)
  })

  it('an empty collection is a valid "no active alerts" answer', () => {
    const r = parseNwsAlerts({ type: 'FeatureCollection', features: [] })
    expect(r.ok && r.alerts).toEqual([])
  })
})
