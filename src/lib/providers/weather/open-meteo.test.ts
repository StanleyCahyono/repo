import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fakeHttp, hang, json } from '../test-helpers'
import type { WeatherPointRequest } from '../types'
import { createOpenMeteoProvider, OPEN_METEO_ATTRIBUTION, parseOpenMeteo } from './open-meteo'

const fixture = () => JSON.parse(readFileSync(new URL('./__fixtures__/open-meteo-forecast.json', import.meta.url), 'utf8'))

const summit: WeatherPointRequest = {
  resortId: 'greek-peak',
  pointKey: 'summit',
  lat: 42.4985,
  lon: -76.156,
  elevationM: 640,
  timezone: 'America/New_York',
  country: 'US',
}

describe('Open-Meteo request', () => {
  it('asks for unambiguous UTC unix times, the point elevation and explicit units', async () => {
    const h = fakeHttp(() => json(fixture()))
    const res = await createOpenMeteoProvider({ http: h.client }).fetchForecast(summit)
    expect(res.ok).toBe(true)
    const u = new URL(h.calls[0].url)
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(u.searchParams.get('timezone')).toBe('GMT')
    expect(u.searchParams.get('timeformat')).toBe('unixtime')
    expect(u.searchParams.get('elevation')).toBe('640')
    expect(u.searchParams.get('wind_speed_unit')).toBe('kmh')
    expect(u.searchParams.get('forecast_days')).toBe('16')
    expect(u.searchParams.get('past_days')).toBe('2')
    expect(u.searchParams.get('hourly')!.split(',')).toContain('freezing_level_height')
    expect(h.calls[0].headers['user-agent']).toMatch(/^Piste\/0\.1 \(\+personal ski planner; contact: /)
  })

  it('clamps horizons to the documented limits and omits elevation when unknown', async () => {
    const h = fakeHttp(() => json(fixture()))
    await createOpenMeteoProvider({ http: h.client }).fetchForecast({ ...summit, elevationM: null }, { forecastDays: 40, pastDays: 500 })
    const u = new URL(h.calls[0].url)
    expect(u.searchParams.get('forecast_days')).toBe('16')
    expect(u.searchParams.get('past_days')).toBe('92')
    expect(u.searchParams.has('elevation')).toBe(false)
  })

  it('uses the customer endpoint with OPEN_METEO_API_KEY but never records the key', async () => {
    const h = fakeHttp(() => json(fixture()), { env: { OPEN_METEO_API_KEY: 'sekret-key-123' } })
    const res = await createOpenMeteoProvider({ http: h.client }).fetchForecast(summit)
    expect(h.calls[0].url).toContain('https://customer-api.open-meteo.com/v1/forecast?')
    expect(h.calls[0].url).toContain('apikey=sekret-key-123')
    expect(JSON.stringify(res)).not.toContain('sekret-key-123')
    expect(res.fetches[0].url).toContain('apikey=REDACTED')
  })
})

describe('Open-Meteo parsing', () => {
  it('keeps provider timestamps, grid position, units, and semantics; never invents a model run time', async () => {
    const h = fakeHttp(() => json(fixture()))
    const res = await createOpenMeteoProvider({ http: h.client }).fetchForecast(summit)
    if (!res.ok) throw new Error(res.error)
    const s = res.data
    expect(s.hourly[0].validTime).toBe('2027-01-15T00:00:00.000Z')
    expect(s.hourly[5].validTime).toBe('2027-01-15T05:00:00.000Z')
    expect(s.intervalSemantics).toBe('preceding-hour')
    expect(s.modelRunAt).toBeNull()
    expect(s.grid).toEqual({ lat: 42.5, lon: -76.125, elevationM: 640 })
    expect(s.requested).toEqual({ lat: 42.4985, lon: -76.156, elevationM: 640 })
    expect(s.units.snowfall).toBe('cm')
    expect(s.kind).toBe('modeled')
    // Snowfall (cm), precipitation (mm water) and snow depth (m) stay distinct quantities.
    expect(s.hourly[1]).toMatchObject({ snowfallCm: 0.98, precipitationMm: 1.4, rainMm: 0, snowDepthM: 0.32, isDay: false, weatherCode: 75 })
    // A null in the source stays null — never 0.
    expect(s.hourly[5].temperatureC).toBeNull()
    expect(res.provenance).toMatchObject({ kind: 'modeled', provider: 'Open-Meteo', note: OPEN_METEO_ATTRIBUTION, fetchedAt: '2027-01-15T14:00:00.000Z' })
    expect(res.capabilities.limitations.join(' ')).toMatch(/statistical downscaling/)
  })

  it('converts non-metric units explicitly', () => {
    const f = fixture()
    f.hourly_units.snowfall = 'inch'
    f.hourly_units.temperature_2m = '°F'
    f.hourly_units.wind_speed_10m = 'mp/h'
    f.hourly_units.snow_depth = 'ft'
    f.hourly.snowfall[0] = 1
    f.hourly.temperature_2m[0] = 32
    f.hourly.wind_speed_10m[0] = 10
    f.hourly.snow_depth[0] = 1
    const r = parseOpenMeteo(f, summit)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.hourly[0].snowfallCm).toBe(2.54)
    expect(r.value.hourly[0].temperatureC).toBe(0)
    expect(r.value.hourly[0].windKmh).toBeCloseTo(16.0934, 3)
    expect(r.value.hourly[0].snowDepthM).toBe(0.3048)
  })

  it('reports absent, all-null and unknown-unit variables as missing and leaves them null', () => {
    const f = fixture()
    delete f.hourly.visibility
    f.hourly.freezing_level_height = f.hourly.freezing_level_height.map(() => null)
    f.hourly_units.cloud_cover = 'oktas'
    const r = parseOpenMeteo(f, summit)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.capabilities.missing).toEqual(expect.arrayContaining(['visibilityM', 'freezingLevelM', 'cloudCoverPct']))
    expect(r.value.capabilities.supplied).not.toContain('visibilityM')
    expect(r.value.hourly.every((p) => p.visibilityM === null && p.freezingLevelM === null && p.cloudCoverPct === null)).toBe(true)
    expect(r.value.capabilities.limitations.join(' ')).toMatch(/unrecognised unit "oktas"/)
    expect(r.value.capabilities.supplied).toContain('snowfallCm')
  })

  it('rejects misaligned arrays instead of shifting values onto the wrong hours', () => {
    const f = fixture()
    f.hourly.snowfall.pop()
    const r = parseOpenMeteo(f, summit)
    expect(r.ok).toBe(false)
  })

  it('surfaces the API reason on a 400 without retrying', async () => {
    const h = fakeHttp(() => json({ error: true, reason: 'Cannot initialize WeatherVariable from invalid String value foo' }, { status: 400 }))
    const res = await createOpenMeteoProvider({ http: h.client }).fetchForecast(summit)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorKind).toBe('http')
    expect(res.retriable).toBe(false)
    expect(res.error).toMatch(/invalid String value/)
    expect(h.calls).toHaveLength(1)
    expect(res.fetches[0]).toMatchObject({ ok: false, httpStatus: 400 })
  })

  it('returns errorKind timeout after bounded retries when the API hangs (no partial series)', async () => {
    const h = fakeHttp((_, init) => hang(init))
    const res = await createOpenMeteoProvider({ http: h.client, timeoutMs: 5, retries: 2 }).fetchForecast(summit)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorKind).toBe('timeout')
    expect(res.retriable).toBe(true)
    expect(h.calls).toHaveLength(3)
    expect(h.sleeps).toHaveLength(2)
    expect(res.fetches[0]).toMatchObject({ ok: false, attempts: 3, httpStatus: null })
  })
})
