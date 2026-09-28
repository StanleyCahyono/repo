import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fakeHttp, json } from '../test-helpers'
import type { FlightOfferQuery } from '../types'
import { createDuffelProvider, normalizeDuffelOffers } from './duffel'

const fixture = () => JSON.parse(readFileSync(new URL('./__fixtures__/duffel-offer-request.json', import.meta.url), 'utf8'))
const q: FlightOfferQuery = { origin: 'ITH', destination: 'SLC', departDate: '2027-01-15', returnDate: '2027-01-19', adults: 1, cabin: 'economy' }

describe('Duffel', () => {
  it('without a token: not-configured, and the network is never touched', async () => {
    const h = fakeHttp(() => json(fixture()))
    const p = createDuffelProvider({ http: h.client })
    expect(p.configured()).toBe(false)
    const res = await p.searchOffers(q)
    expect(res.ok === false && res.errorKind).toBe('not-configured')
    expect(res.ok === false && res.retriable).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('sends the documented request and labels test tokens as test data', async () => {
    const token = 'duffel_test_abc123secret'
    const h = fakeHttp(() => json(fixture(), { status: 201 }), { env: { DUFFEL_ACCESS_TOKEN: token } })
    const res = await createDuffelProvider({ http: h.client }).searchOffers(q)
    if (!res.ok) throw new Error(res.error)
    const call = h.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://api.duffel.com/air/offer_requests?return_offers=true')
    expect(call.headers.authorization).toBe(`Bearer ${token}`)
    expect(call.headers['duffel-version']).toBe('v2')
    expect(JSON.parse(call.body!).data).toEqual({
      slices: [
        { origin: 'ITH', destination: 'SLC', departure_date: '2027-01-15' },
        { origin: 'SLC', destination: 'ITH', departure_date: '2027-01-19' },
      ],
      passengers: [{ type: 'adult' }],
      cabin_class: 'economy',
    })
    expect(res.data[0].testMode).toBe(true)
    expect(res.provenance.kind).toBe('demo') // test data never looks like a live fare
    expect(res.capabilities.limitations[0]).toMatch(/TEST MODE/)
    // The token never leaks into recorded fetches or provenance.
    expect(JSON.stringify({ f: res.fetches, p: res.provenance })).not.toContain('abc123secret')
  })

  it('normalises amounts to minor units, times to UTC with local wall time kept, and real flight numbers', () => {
    const r = normalizeDuffelOffers(fixture(), false)
    if (!r.ok) throw new Error(r.error)
    const o = r.offers[0]
    expect(o).toMatchObject({ id: 'off_0000AUde3KY1SptM4ABSfU', totalAmountMinor: 24560, currency: 'USD', expiresAt: '2027-01-10T15:51:01.927Z', owner: 'Duffel Airways' })
    expect(o.testMode).toBe(true) // response live_mode:false even with a live token
    const [s1, s2] = o.slices[0].segments
    expect(s1).toMatchObject({ carrier: 'ZZ', flightNumber: '1234', origin: 'ITH', destination: 'DTW', departAt: '2027-01-15T11:00:00.000Z', departLocal: '2027-01-15T06:00:00' })
    expect(s2).toMatchObject({ flightNumber: '88', arriveAt: '2027-01-15T18:05:00.000Z' })
    expect(o.slices[0]).toMatchObject({ origin: 'ITH', destination: 'SLC', departAt: s1.departAt, arriveAt: s2.arriveAt })
    expect(o.baggageNotes).toMatch(/1 carry-on/)
  })

  it('keeps airport-local times (flagged) when no time zone is supplied', () => {
    const f = fixture()
    delete f.data.offers[0].slices[0].segments[0].origin.time_zone
    const r = normalizeDuffelOffers(f, false)
    if (!r.ok) throw new Error(r.error)
    expect(r.offers[0].slices[0].segments[0].departAt).toBe('2027-01-15T06:00:00')
    expect(r.limitations.join(' ')).toMatch(/airport-local/)
  })

  it('rejects a bad token without retrying and without echoing it', async () => {
    const token = 'duffel_live_supersecret'
    const h = fakeHttp(() => json({ errors: [{ title: 'Unauthorized', message: 'The access token used is not valid' }] }, { status: 401 }), { env: { DUFFEL_ACCESS_TOKEN: token } })
    const res = await createDuffelProvider({ http: h.client }).searchOffers(q)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorKind).toBe('http')
    expect(res.retriable).toBe(false)
    expect(res.error).toMatch(/not valid/)
    expect(res.error).not.toContain('supersecret')
    expect(h.calls).toHaveLength(1)
  })

  it('validates the query before spending an API call', async () => {
    const h = fakeHttp(() => json(fixture()), { env: { DUFFEL_ACCESS_TOKEN: 'duffel_test_x' } })
    const res = await createDuffelProvider({ http: h.client }).searchOffers({ ...q, returnDate: '2027-01-10' })
    expect(res.ok === false && res.errorKind).toBe('unsupported')
    expect(h.calls).toHaveLength(0)
  })
})
