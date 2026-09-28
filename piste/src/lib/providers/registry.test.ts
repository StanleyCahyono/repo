import { describe, expect, it } from 'vitest'
import { providerStatus, weatherProviders, weatherProvidersFor } from './registry'

const byId = (env: Record<string, string>) => Object.fromEntries(providerStatus(env).map((s) => [s.id, s]))

describe('providerStatus', () => {
  it('reports honest states with no credentials', () => {
    const s = byId({})
    expect(s['open-meteo'].state).toBe('live')
    expect(s['nws-alerts'].state).toBe('live')
    expect(s.duffel.state).toBe('needs-credentials')
    expect(s['greek-peak-official'].state).toBe('unverified')
    expect(s['alta-official'].state).toBe('unverified')
    expect(s['nws-alerts'].notes.join(' ')).toMatch(/PISTE_CONTACT/)
  })

  it('flags a Duffel test token as test mode and never exposes credential values', () => {
    const s = byId({ DUFFEL_ACCESS_TOKEN: 'duffel_test_topsecret', OPEN_METEO_API_KEY: 'om-secret' })
    expect(s.duffel).toMatchObject({ state: 'live', credentialSet: true, testMode: true })
    expect(s['open-meteo'].credentialSet).toBe(true)
    expect(JSON.stringify(providerStatus({ DUFFEL_ACCESS_TOKEN: 'duffel_test_topsecret', OPEN_METEO_API_KEY: 'om-secret' }))).not.toMatch(/topsecret|om-secret/)
  })

  it('can disable a connector explicitly', () => {
    const s = byId({ PISTE_DISABLED_PROVIDERS: 'nws-grid, greek-peak-official' })
    expect(s['nws-grid'].state).toBe('disabled')
    expect(s['greek-peak-official'].state).toBe('disabled')
    expect(s['open-meteo'].state).toBe('live')
  })
})

describe('weather provider order', () => {
  it('uses Open-Meteo first and adds NWS only for US points', () => {
    expect(weatherProviders.map((p) => p.id)).toEqual(['open-meteo', 'nws-grid'])
    const base = { resortId: 'x', pointKey: 'base', lat: 47.13, lon: 10.27, elevationM: 1300, timezone: 'Europe/Vienna', country: 'AT' }
    expect(weatherProvidersFor(base, {}).map((p) => p.id)).toEqual(['open-meteo'])
    expect(weatherProvidersFor({ ...base, country: 'US', lat: 40.59, lon: -111.64 }, {}).map((p) => p.id)).toEqual(['open-meteo', 'nws-grid'])
    expect(weatherProvidersFor({ ...base, country: 'US' }, { PISTE_DISABLED_PROVIDERS: 'nws-grid' }).map((p) => p.id)).toEqual(['open-meteo'])
  })
})
