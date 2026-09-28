import { describe, expect, it } from 'vitest'
import { fakeHttp, json } from '../test-helpers'
import { createFrankfurterProvider } from './frankfurter'

describe('Frankfurter FX', () => {
  it('returns ECB rates as exact decimal strings with the reference date', async () => {
    const h = fakeHttp(() => json({ amount: 1.0, base: 'USD', date: '2027-01-14', rates: { CAD: 1.3712, EUR: 0.00000091 } }))
    const res = await createFrankfurterProvider({ http: h.client }).fetchRates('usd', ['CAD', 'EUR', 'USD'])
    if (!res.ok) throw new Error(res.error)
    expect(h.calls[0].url).toBe('https://api.frankfurter.app/latest?from=USD&to=CAD,EUR')
    expect(res.data).toEqual([
      { base: 'USD', quote: 'CAD', rate: '1.3712', rateDate: '2027-01-14' },
      { base: 'USD', quote: 'EUR', rate: '0.00000091', rateDate: '2027-01-14' }, // never "9.1e-7"
    ])
    expect(res.provenance).toMatchObject({ kind: 'official', validFrom: '2027-01-14' })
  })

  it('lists currencies the source did not return as missing instead of inventing them', async () => {
    const h = fakeHttp(() => json({ amount: 1, base: 'USD', date: '2027-01-14', rates: { CAD: 1.37 } }))
    const res = await createFrankfurterProvider({ http: h.client }).fetchRates('USD', ['CAD', 'CHF'])
    if (!res.ok) throw new Error(res.error)
    expect(res.data.map((r) => r.quote)).toEqual(['CAD'])
    expect(res.capabilities.missing).toEqual(['USD/CHF'])
  })

  it('rejects a response for the wrong base and bad codes without a request', async () => {
    const h = fakeHttp(() => json({ amount: 1, base: 'EUR', date: '2027-01-14', rates: { CAD: 1.5 } }))
    const p = createFrankfurterProvider({ http: h.client })
    expect((await p.fetchRates('USD', ['CAD'])).ok).toBe(false)
    const bad = await p.fetchRates('US$', ['CAD'])
    expect(bad.ok === false && bad.errorKind).toBe('unsupported')
    expect(h.calls).toHaveLength(1)
  })
})
