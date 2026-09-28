import { describe, expect, it } from 'vitest'
import { fakeHttp } from '../test-helpers'
import type { Resolver } from '../url-guard'
import {
  checkLink,
  directionsLink,
  embeddableFrom,
  flightSearchLinks,
  googleFlightsSearchUrl,
  googleMapsDirectionsUrl,
  kayakFlightsUrl,
  nwsForecastPageUrl,
  openSkiMapUrl,
} from './index'

describe('travel link builders', () => {
  it('builds the documented Google Flights q= form with proper encoding', () => {
    expect(googleFlightsSearchUrl({ from: 'ITH', to: 'SLC', depart: '2027-01-15', return: '2027-01-19' })).toBe(
      'https://www.google.com/travel/flights?q=Flights%20from%20ITH%20to%20SLC%20on%202027-01-15%20through%202027-01-19',
    )
    expect(googleFlightsSearchUrl({ from: ' ith', to: 'slc ', depart: '2027-01-15' })).toBe(
      'https://www.google.com/travel/flights?q=Flights%20from%20ITH%20to%20SLC%20on%202027-01-15',
    )
  })

  it('builds KAYAK path URLs and rejects malformed input instead of emitting a broken link', () => {
    expect(kayakFlightsUrl({ from: 'ITH', to: 'SLC', depart: '2027-01-15', return: '2027-01-19' })).toBe('https://www.kayak.com/flights/ITH-SLC/2027-01-15/2027-01-19')
    expect(kayakFlightsUrl({ from: 'ITH', to: 'SLC', depart: '2027-01-15' })).toBe('https://www.kayak.com/flights/ITH-SLC/2027-01-15')
    expect(kayakFlightsUrl({ from: 'ITH/../x', to: 'SLC', depart: '2027-01-15' })).toBeNull()
    expect(kayakFlightsUrl({ from: 'ITH', to: 'SLC', depart: '2027-01-15', return: '2027-01-10' })).toBeNull()
    expect(googleFlightsSearchUrl({ from: 'ITH', to: 'SLC', depart: '15/01/2027' })).toBeNull()
    expect(googleFlightsSearchUrl({ from: 'ITH', to: 'ITH', depart: '2027-01-15' })).toBeNull()
  })

  it('encodes Google Maps directions parameters (addresses and coordinates)', () => {
    expect(googleMapsDirectionsUrl('Ithaca, NY', { lat: 42.5086, lon: -76.146 })).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=Ithaca%2C%20NY&destination=42.5086%2C-76.146&travelmode=driving',
    )
    expect(googleMapsDirectionsUrl('A & B #1', 'Alta, UT')).toContain('origin=A%20%26%20B%20%231&')
    expect(googleMapsDirectionsUrl({ lat: 95, lon: 0 }, 'Alta, UT')).toBeNull()
  })

  it('builds OpenSkiMap and NWS forecast page links', () => {
    expect(openSkiMapUrl(40.5884, -111.6386)).toBe('https://openskimap.org/#12/40.5884/-111.6386')
    expect(nwsForecastPageUrl(42.5086, -76.146)).toBe('https://forecast.weather.gov/MapClick.php?lat=42.5086&lon=-76.146')
    expect(openSkiMapUrl(Number.NaN, 0)).toBeNull()
  })

  it('labels every link as a search/direction link, never live data', () => {
    const links = flightSearchLinks({ from: 'ITH', to: 'SLC', depart: '2027-01-15', return: '2027-01-19' })
    expect(links.map((l) => l.label)).toEqual(['Search Google Flights', 'Search KAYAK'])
    expect(links.every((l) => l.liveData === false && /no fares/.test(l.note))).toBe(true)
    expect(directionsLink('Ithaca, NY', 'Greek Peak Mountain Resort')?.kind).toBe('directions')
  })
})

describe('checkLink', () => {
  const resolver: Resolver = async (host) => [{ address: host === 'internal.example.com' ? '10.0.0.7' : '93.184.216.34', family: 4 }]

  it('follows redirects manually, records the final URL and falls back to GET when HEAD is refused', async () => {
    const h = fakeHttp((c) => {
      if (c.url === 'https://www.greekpeak.net/old') return new Response(null, { status: 301, headers: { location: '/ski-ride/current-conditions/' } })
      if (c.method === 'HEAD') return new Response(null, { status: 405 })
      return new Response('<html>ok</html>', { status: 200, headers: { 'x-frame-options': 'SAMEORIGIN' } })
    })
    const r = await checkLink('https://www.greekpeak.net/old', { http: h.client, resolver })
    expect(r).toMatchObject({ ok: true, httpStatus: 200, finalUrl: 'https://www.greekpeak.net/ski-ride/current-conditions/', embeddable: false, error: null })
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'HEAD https://www.greekpeak.net/old',
      'HEAD https://www.greekpeak.net/ski-ride/current-conditions/',
      'GET https://www.greekpeak.net/ski-ride/current-conditions/',
    ])
  })

  it('blocks a redirect hop into a private network', async () => {
    const h = fakeHttp(() => new Response(null, { status: 302, headers: { location: 'http://internal.example.com/admin' } }))
    const r = await checkLink('https://public.example.com/go', { http: h.client, resolver })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^Blocked: .*non-public address 10\.0\.0\.7/)
    expect(h.calls).toHaveLength(1)
  })

  it('never requests a private/metadata URL at all', async () => {
    const h = fakeHttp(() => new Response('secret'))
    const r = await checkLink('http://169.254.169.254/latest/meta-data/', { http: h.client, resolver })
    expect(r.ok).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('stops after 5 redirects', async () => {
    let i = 0
    const h = fakeHttp(() => new Response(null, { status: 302, headers: { location: `/hop${++i}` } }))
    const r = await checkLink('https://loop.example.com/', { http: h.client, resolver })
    expect(r.error).toMatch(/Too many redirects/)
    expect(h.calls).toHaveLength(6)
  })

  it('reads frame restrictions from CSP frame-ancestors', () => {
    expect(embeddableFrom(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self' https://partner.example" }))).toBe(false)
    expect(embeddableFrom(new Headers({ 'content-security-policy': "frame-ancestors 'none'" }))).toBe(false)
    expect(embeddableFrom(new Headers({ 'content-security-policy': 'frame-ancestors *' }))).toBe(true)
    expect(embeddableFrom(new Headers({ 'x-frame-options': 'DENY' }))).toBe(false)
    expect(embeddableFrom(new Headers({}))).toBe(true)
  })
})
