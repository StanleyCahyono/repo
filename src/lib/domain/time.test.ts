import { describe, expect, it } from 'vitest'
import {
  hemisphereOf,
  nextSeasonId,
  northernSeasonOf,
  planningSeasonBounds,
  previousSeasonId,
  seasonBounds,
  seasonIdFor,
  seasonIdForHemisphere,
  seasonIdForResort,
  seasonIdsForDates,
  seasonResolver,
  skiWindow,
} from './time'

const thredbo = { lat: -36.5048 }
const alta = { lat: 40.5885 }

describe('seasonIdForResort', () => {
  it('keeps the 1 July boundary in the Northern Hemisphere', () => {
    expect(seasonIdForResort('2026-06-30', alta)).toBe('2025-26')
    expect(seasonIdForResort('2026-07-01', alta)).toBe('2026-27')
    expect(seasonIdForResort('2027-01-15', alta)).toBe(seasonIdFor('2027-01-15'))
  })

  it('files a whole Southern Hemisphere winter under one season: the calendar year Y is (Y-1)-(YY)', () => {
    // Winter 2026 (June–October) is 2025-26 — not split at 1 July.
    for (const d of ['2026-06-06', '2026-06-30', '2026-07-01', '2026-09-30', '2026-10-18']) expect(seasonIdForResort(d, thredbo)).toBe('2025-26')
    // Winter 2027 is 2026-27: the season a 2026-27 Ikon or Epic pass covers there.
    for (const d of ['2027-06-12', '2027-08-01', '2027-10-04']) expect(seasonIdForResort(d, thredbo)).toBe('2026-27')
  })

  it('changes a Southern Hemisphere season on 1 January', () => {
    expect(seasonIdForResort('2026-12-31', thredbo)).toBe('2025-26')
    expect(seasonIdForResort('2027-01-01', thredbo)).toBe('2026-27')
  })

  it('treats the equator, unknown and invalid latitudes as northern', () => {
    expect(hemisphereOf(0)).toBe('north')
    expect(hemisphereOf(null)).toBe('north')
    expect(hemisphereOf(Number.NaN)).toBe('north')
    expect(hemisphereOf(-0.1)).toBe('south')
    expect(seasonIdForHemisphere('2026-08-01', 'north')).toBe('2026-27')
    expect(seasonIdForHemisphere('2026-08-01', 'south')).toBe('2025-26')
  })
})

describe('season spans', () => {
  it('bounds a season id per hemisphere', () => {
    expect(seasonBounds('2026-27')).toEqual({ from: '2026-07-01', to: '2027-06-30' })
    expect(seasonBounds('2026-27', 'south')).toEqual({ from: '2027-01-01', to: '2027-12-31' })
    expect(planningSeasonBounds('2026-27', false)).toEqual({ from: '2026-07-01', to: '2027-06-30' })
    expect(planningSeasonBounds('2026-27', true)).toEqual({ from: '2026-07-01', to: '2027-12-31' })
  })

  it('draws the winter months per hemisphere', () => {
    expect(skiWindow('2026-27')).toEqual({ from: '2026-11-01', to: '2027-04-30' })
    expect(skiWindow('2026-27', 'south')).toEqual({ from: '2027-05-01', to: '2027-10-31' })
  })

  it('steps season ids and lists every season a date can belong to', () => {
    expect(nextSeasonId('2026-27')).toBe('2027-28')
    expect(previousSeasonId('2026-27')).toBe('2025-26')
    expect(previousSeasonId('2000-01')).toBe('1999-00')
    expect(seasonIdsForDates(['2026-09-30']).sort()).toEqual(['2025-26', '2026-27'])
    expect(seasonIdsForDates(['2027-01-15'])).toEqual(['2026-27'])
  })

  it('resolves seasons per resort id', () => {
    const seasonOf = seasonResolver([
      { id: 'thredbo', lat: thredbo.lat },
      { id: 'alta', lat: alta.lat },
    ])
    expect(seasonOf('thredbo', '2027-08-01')).toBe('2026-27')
    expect(seasonOf('alta', '2027-08-01')).toBe('2027-28')
    expect(seasonOf('unknown', '2027-08-01')).toBe('2027-28')
    expect(seasonOf(null, '2027-08-01')).toBe('2027-28')
    // No southern resort: the northern resolver itself.
    expect(seasonResolver([{ id: 'alta', lat: alta.lat }])).toBe(northernSeasonOf)
  })
})
