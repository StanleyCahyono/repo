import { describe, expect, it } from 'vitest'
import { estimateOpeningWindow, openingLabel, projectToSeason } from './season'

describe('projectToSeason', () => {
  it('keeps late-autumn dates in the start year and spring dates in the end year', () => {
    expect(projectToSeason('2024-12-05', '2026-27')).toBe('2026-12-05')
    expect(projectToSeason('2025-04-04', '2026-27')).toBe('2027-04-04')
  })
  it('maps Feb 29 to Feb 28 in non-leap target years', () => {
    expect(projectToSeason('2024-02-29', '2026-27')).toBe('2027-02-28')
  })
})

describe('estimateOpeningWindow', () => {
  it('spans the earliest and latest projected openings', () => {
    const est = estimateOpeningWindow(
      [
        { season: '2025-26', opened: '2025-11-28' },
        { season: '2024-25', opened: '2024-12-05' },
        { season: '2023-24', opened: '2023-12-21' },
      ],
      '2026-27',
    )
    expect(est).toMatchObject({ from: '2026-11-28', to: '2026-12-21' })
    expect(est?.basis).toMatch(/Piste estimate/)
  })
  it('widens a single data point to ±7 days and ignores the target season itself', () => {
    const est = estimateOpeningWindow(
      [
        { season: '2025-26', opened: '2025-11-28' },
        { season: '2026-27', opened: '2026-11-20' },
      ],
      '2026-27',
    )
    expect(est).toMatchObject({ from: '2026-11-21', to: '2026-12-05' })
  })
  it('returns null without history', () => {
    expect(estimateOpeningWindow([{ season: '2025-26', opened: null }], '2026-27')).toBeNull()
  })
})

describe('openingLabel', () => {
  const base = { announcedOpening: null, estimatedOpenFrom: null, estimatedOpenTo: null, actualOpening: null, announcedClosing: null, actualClosing: null }
  it('never turns an announced date into Opened when the date passes', () => {
    expect(openingLabel({ ...base, announcedOpening: '2026-11-27' }, '2026-12-10').label).toBe('announced')
  })
  it('reports Opened only from an actual opening on or before today', () => {
    expect(openingLabel({ ...base, announcedOpening: '2026-11-27', actualOpening: '2026-12-02' }, '2026-12-01').label).toBe('announced')
    expect(openingLabel({ ...base, actualOpening: '2026-12-02' }, '2026-12-02').label).toBe('opened')
  })
  it('falls back to Estimated then Not announced', () => {
    expect(openingLabel({ ...base, estimatedOpenFrom: '2026-11-28', estimatedOpenTo: '2026-12-21' }, '2026-09-28')).toEqual({ label: 'estimated', date: '2026-11-28', to: '2026-12-21' })
    expect(openingLabel(base, '2026-09-28').label).toBe('not-announced')
  })
})
