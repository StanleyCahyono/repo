import { describe, expect, it } from 'vitest'
import type { RidePlan } from '@/lib/data/ride'
import { availableModes, buildJourney, resolveSelection } from './journey-model'

function plan(over: Partial<RidePlan> = {}): RidePlan {
  return {
    resort: { id: 'x', name: 'X Resort', short: 'X', where: 'R · US', lat: 46.02, lon: 7.75, tz: 'Europe/Zurich', href: '/resorts/x', country: 'CH', baseM: null, summitM: null },
    home: { name: 'Ithaca, NY', lat: 42.44, lon: -76.5, tz: 'America/New_York' },
    units: { temperature: 'F', snow: 'in', distance: 'mi', elevation: 'ft', speed: 'mph' },
    straightKm: 6300,
    drive: null,
    origins: [
      { iata: 'ITH', name: null, city: null, lat: 42.491, lon: -76.4584, minutes: 15, km: 11, role: 'origin', confirm: null },
      { iata: 'SYR', name: null, city: null, lat: 43.11, lon: -76.1, minutes: 75, km: 90, role: 'origin', confirm: null },
    ],
    gateways: [{ iata: 'GVA', name: null, city: null, lat: 46.2381, lon: 6.109, minutes: 195, km: 235, role: 'practical', confirm: null }],
    transfers: [],
    recommended: 'fly',
    verdictNote: null,
    leaveBy: { state: 'unknown', reason: 'x', short: 'x', lastSeason: null },
    opening: null,
    weather: null,
    flightSearch: {},
    unknowns: [],
    demo: false,
    ...over,
  }
}

describe('selection', () => {
  it('falls back to what the plan supports', () => {
    const p = plan()
    expect(availableModes(p)).toEqual(['fly'])
    expect(resolveSelection(p, { mode: 'drive' })).toEqual({ mode: 'fly', via: 'GVA', from: 'ITH' })
    expect(resolveSelection(p, { from: 'SYR', via: 'NOPE' })).toEqual({ mode: 'fly', via: 'GVA', from: 'SYR' })
  })
  it('offers drive when there is nothing else, even without an estimate', () => {
    const p = plan({ gateways: [], recommended: 'none' })
    expect(availableModes(p)).toEqual(['drive'])
  })
})

describe('buildJourney', () => {
  it('builds ground, illustrative air and transfer legs for a flight', () => {
    const j = buildJourney(plan(), { mode: 'fly', via: 'GVA', from: 'ITH' })
    expect(j.legs.map((l) => l.kind)).toEqual(['ground', 'air', 'transfer'])
    expect(j.legs[1].minutes).toBeNull()
    expect(j.legs[0].minutes).toBe(15)
    expect(j.legs[2].minutes).toBe(195)
    expect(j.pins.map((p) => p.label)).toEqual(['Ithaca, NY', 'ITH', 'GVA', 'X'])
    // Legs join end to end.
    expect(j.legs[1].from).toEqual(j.legs[0].to)
    expect(j.legs[2].from).toEqual(j.legs[1].to)
  })

  it('unwraps longitudes across the antimeridian', () => {
    const p = plan({
      resort: { ...plan().resort, lat: 42.86, lon: 140.7 },
      gateways: [{ iata: 'CTS', name: null, city: null, lat: 42.7752, lon: 141.6923, minutes: 130, km: 110, role: 'practical', confirm: null }],
    })
    const j = buildJourney(p, { mode: 'fly', via: 'CTS', from: 'ITH' })
    const all = j.legs.flatMap((l) => l.coords)
    for (let i = 1; i < all.length; i++) expect(Math.abs(all[i][0] - all[i - 1][0])).toBeLessThan(180)
    expect(j.pins[3].at[0]).toBeCloseTo(140.7 - 360, 3)
  })

  it('draws a single approximate drive leg', () => {
    const p = plan({ drive: { minutes: 33, winterMinutes: 40, bufferPct: 20, km: 31.7, isEstimate: true, basis: null, confirm: null, directionsUrl: null }, recommended: 'drive' })
    const j = buildJourney(p, resolveSelection(p, {}))
    expect(j.mode).toBe('drive')
    expect(j.legs).toHaveLength(1)
    expect(j.legs[0].approx).toBe(true)
    expect(j.legs[0].minutes).toBe(33)
  })
})
