import { describe, expect, it } from 'vitest'
import type { PassAccessRuleRow, ResortRow, ResortSeasonRow, TravelOptionRow } from '@/lib/db/rows'
import { provenance, type VerificationLevel } from '@/lib/domain/types'
import { isReferenceText, shownAirport, shownPassProduct, shownResort, shownRules, shownSeason, shownTravel } from './shown'

const prov = (verification: VerificationLevel) => provenance({ kind: 'manual', provider: 'Piste catalog (web research)', verification })

const resort = (v: VerificationLevel): ResortRow =>
  ({
    id: 'r',
    origin: 'catalog',
    lat: 46,
    lon: 7,
    timezone: 'Europe/Zurich',
    locationProv: prov('unverified'),
    baseElevationM: 1600,
    summitElevationM: 3800,
    verticalM: 2200,
    elevationProv: prov(v),
    terrain: { trails: 50, lifts: 20, skiableAcres: null, beginnerPct: 30, intermediatePct: 40, advancedPct: 30, terrainParks: null, season: null, prov: prov(v) },
    features: { nightSkiing: null, snowmakingPct: null, lessons: true, rentals: true, onMountainLodging: null, tubing: null, childcare: null, beginnerArea: null, prov: prov(v) },
    learning: 'Reference note: ski schools in town (unverified). Confirm.',
    character: 'High alpine village resort (per search summary).',
    operator: 'Example Lifts AG — reference, confirm',
    links: { official: 'https://example.org' },
  }) as unknown as ResortRow

describe('display policy (shown.ts)', () => {
  it('shows researched facts as they are', () => {
    const r = shownResort(resort('search-summary'))
    expect(r).toMatchObject({ baseElevationM: 1600, summitElevationM: 3800, terrain: { trails: 50 }, features: { lessons: true } })
  })

  it('drops unverified facts but keeps coordinates, zone and identity', () => {
    const r = shownResort(resort('unverified'))
    expect(r).toMatchObject({ id: 'r', lat: 46, lon: 7, timezone: 'Europe/Zurich', baseElevationM: null, summitElevationM: null, verticalM: null, terrain: null, features: null })
    expect(r.character).toBe('High alpine village resort.')
    expect(r.locationProv).toBeNull()
  })

  it('removes research caveats from catalog prose, keeping the rest as written', () => {
    const r = shownResort(resort('search-summary'))
    expect(r.character).toBe('High alpine village resort.')
    expect(r.operator).toBe('Example Lifts AG')
  })

  it('drops free text written as a reference note', () => {
    expect(isReferenceText('Reference note: ski schools in town.')).toBe(true)
    expect(isReferenceText('Reference, confirm: UTA ski bus.')).toBe(true)
    expect(isReferenceText('Piste reference data — confirm at source')).toBe(true)
    expect(isReferenceText('References to the old lift map')).toBe(false)
    expect(shownResort(resort('search-summary')).learning).toBeNull()
  })

  it('drops unverified announced dates, never the labelled estimate', () => {
    const row = { announcedOpening: '2026-11-27', announcedOpeningText: 'Late Nov', announcedOpeningProv: prov('unverified'), estimatedOpenFrom: '2026-11-25', announcedClosing: '2027-04-18', announcedClosingProv: prov('search-summary') } as unknown as ResortSeasonRow
    expect(shownSeason(row)).toMatchObject({ announcedOpening: null, announcedOpeningText: null, estimatedOpenFrom: '2026-11-25', announcedClosing: '2027-04-18' })
  })

  it('keeps an unverified gateway airport as identity only, and drops unverified drives and transfers', () => {
    const rows = [
      { mode: 'drive-from-home', minutes: 200, km: 300, basis: 'x', notes: null, prov: prov('unverified') },
      { mode: 'airport', airportIata: 'GVA', role: 'practical', minutes: 180, km: 230, basis: 'y', notes: 'z', prov: prov('unverified') },
      { mode: 'transfer', name: 'Bus', notes: 'Reference, confirm: a bus has run.', prov: prov('search-summary') },
      { mode: 'transfer', name: 'Train', notes: 'Hourly trains from Visp.', prov: prov('search-summary') },
    ] as unknown as TravelOptionRow[]
    const out = shownTravel(rows)
    expect(out.map((t) => t.mode)).toEqual(['airport', 'transfer'])
    expect(out[0]).toMatchObject({ airportIata: 'GVA', role: 'practical', minutes: null, km: null, basis: null, notes: null })
    expect(out[1]).toMatchObject({ name: 'Train' })
  })

  it('keeps an airport’s identity but not its unverified facts', () => {
    const a = shownAirport({
      iata: 'GVA',
      name: 'Geneva Airport',
      city: 'Geneva',
      lat: 46.2,
      lon: 6.1,
      airlines: [{ airline: 'X', nonstops: [], seasonal: null, sourceUrl: null }],
      parking: 'P1',
      notes: 'n',
      officialUrl: 'https://example.org',
      airlinesUrl: null,
      driveFromHome: { minutes: 60, km: 50, basis: null, prov: prov('unverified') },
      prov: prov('unverified'),
    })
    expect(a).toMatchObject({ iata: 'GVA', name: 'Geneva Airport', lat: 46.2, airlines: [], parking: null, notes: null, officialUrl: null, driveFromHome: null })
  })

  it('keeps an unverified pass product’s name, not its summaries', () => {
    const p = shownPassProduct({ id: 'p', familyId: 'ikon', seasonId: '2026-27', name: 'Ikon Pass', resortId: null, summary: 's', blackoutsSummary: 'b', reservationsSummary: 'r', salesDeadline: '2026-12-01', salesDeadlineText: 't', renewalNotes: 'n', version: 1, prov: prov('unverified'), updatedAt: '' })
    expect(p).toMatchObject({ name: 'Ikon Pass', summary: null, blackoutsSummary: null, reservationsSummary: null, salesDeadline: null, salesDeadlineText: null, renewalNotes: null })
  })

  it('hides a pair whose current rule is unknown or unverified — an older version never resurfaces', () => {
    const rule = (resortId: string, version: number, access: PassAccessRuleRow['access'], v: VerificationLevel) => ({ productId: 'p', resortId, version, access, prov: prov(v) })
    const rules = [
      rule('a', 1, 'limited-days', 'search-summary'),
      rule('a', 2, 'unknown', 'search-summary'),
      rule('b', 1, 'unlimited', 'unverified'),
      rule('c', 1, 'unknown', 'official-page'),
      rule('d', 1, 'not-included', 'search-summary'),
      rule('d', 2, 'unlimited', 'search-summary'),
    ]
    expect(shownRules(rules).map((r) => `${r.resortId}${r.version}`)).toEqual(['d1', 'd2'])
  })
})

describe('shownProv', () => {
  it('names the catalog plainly and keeps machine markers', async () => {
    const { shownProv } = await import('./shown')
    const p = shownProv(provenance({ kind: 'official', provider: 'Piste catalog (web research)', verification: 'search-summary', note: 'catalog-research' }))
    expect(p).toMatchObject({ provider: 'Piste catalog', note: 'catalog-research' })
    const q = shownProv(provenance({ kind: 'manual', provider: 'Piste catalog (web research)', verification: 'search-summary', note: 'Season 2025-26 (per search summary).' }))
    expect(q.note).toBe('Season 2025-26.')
  })
})
