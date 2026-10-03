import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { money } from '@/lib/domain/money'
import { provenance } from '@/lib/domain/types'
import { adultDayTickets, breakEvenDays, familyCards, seasonContextFor } from './passes-hud'
import type { FamilyView, PassProductView } from './passes'

const row = (o: Partial<Record<'announcedOpening' | 'actualOpening' | 'announcedClosing' | 'actualClosing' | 'estimatedOpenFrom', string | null>>) => ({
  announcedOpening: null,
  actualOpening: null,
  announcedClosing: null,
  actualClosing: null,
  estimatedOpenFrom: null,
  ...o,
})

describe('seasonContextFor', () => {
  const season = row({ announcedOpening: '2026-11-06', announcedClosing: '2027-04-04' })
  it('places dates before, inside and after an announced season', () => {
    expect(seasonContextFor(season, '2026-10-10', '2026-10-10')).toMatchObject({ state: 'before', outside: true, openingKind: 'announced' })
    expect(seasonContextFor(season, '2026-12-12', '2026-12-13')).toMatchObject({ state: 'inside', outside: false })
    expect(seasonContextFor(season, '2027-04-03', '2027-04-06')).toMatchObject({ state: 'partly', outside: false })
    expect(seasonContextFor(season, '2027-04-10', '2027-04-10')).toMatchObject({ state: 'after', outside: true })
  })
  it('never treats an unannounced season as inside; an estimate stays an estimate', () => {
    expect(seasonContextFor(row({ estimatedOpenFrom: '2026-11-28' }), '2026-12-12', '2026-12-12')).toMatchObject({ state: 'unannounced', outside: false, estimateFrom: '2026-11-28' })
    expect(seasonContextFor(null, '2026-12-12', '2026-12-12')).toMatchObject({ state: 'unannounced', opening: null })
  })
  it('prefers the actual opening over the announced one', () => {
    expect(seasonContextFor(row({ announcedOpening: '2026-11-20', actualOpening: '2026-11-27' }), '2026-11-22', '2026-11-22')).toMatchObject({ state: 'before', openingKind: 'actual' })
  })
})

describe('adultDayTickets', () => {
  const base = { category: null, currency: 'USD', seasonId: '2025-26', dayType: null, prov: provenance({ kind: 'official', provider: 'test' }) }
  it('keeps adult single-day figures from the newest season only', () => {
    const refs = adultDayTickets(
      [
        { ...base, item: 'Adult 1-day lift ticket', category: 'Adult', amountMinor: 12000 },
        { ...base, item: 'All-day lift ticket, Tuesdays', amountMinor: 4800 },
        { ...base, item: '3-day lift ticket pack', amountMinor: 24900 },
        { ...base, item: 'Lift ticket, ages 6 and under', category: 'Child (6 and under)', amountMinor: 0 },
        { ...base, item: 'College Wednesday', category: 'College', amountMinor: 5000 },
        { ...base, item: 'Old adult ticket', category: 'Adult', amountMinor: 9000, seasonId: '2024-25' },
        { ...base, item: 'Euro ticket', amountMinor: 9000, currency: 'EUR' },
      ],
      'USD',
    )
    expect(refs.map((r) => r.amount.amountMinor).sort()).toEqual([12000, 4800])
  })
})

describe('breakEvenDays', () => {
  it('divides only matching currencies and never by zero', () => {
    expect(breakEvenDays(money(99900, 'USD'), money(12000, 'USD'))).toBeCloseTo(8.325)
    expect(breakEvenDays(money(99900, 'USD'), money(12000, 'EUR'))).toBeNull()
    expect(breakEvenDays(money(99900, 'USD'), money(0, 'USD'))).toBeNull()
  })
})

describe('familyCards', () => {
  const fam = (id: string, productIds: string[], official: string | null = null): FamilyView => ({ id, name: `${id} pass`, operator: null, links: { official }, productIds, prov: null })
  const product = (id: string, familyId: string, price: number | null, resortId: string | null = null): PassProductView =>
    ({
      id,
      familyId,
      familyName: familyId,
      name: id,
      seasonId: '2026-27',
      resortId,
      resortName: resortId,
      summary: null,
      blackoutsSummary: null,
      reservationsSummary: null,
      renewalNotes: null,
      salesDeadline: null,
      prices: [],
      currentPrice: price == null ? null : ({ amount: money(price, 'USD') } as PassProductView['currentPrice']),
      ownedBy: [],
      ownedByMe: false,
      resortCount: 0,
      verificationLabel: null,
      prov: null,
    }) as PassProductView

  it('shows an unknown price as null (never 0) and keeps the official link', () => {
    const cards = familyCards([fam('epic', ['e1'], 'https://www.epicpass.com/'), fam('ikon', ['i1'], 'https://www.ikonpass.com/')], [product('e1', 'epic', null), product('i1', 'ikon', null)], '2026-27', new Set())
    expect(cards.map((c) => c.id)).toEqual(['ikon', 'epic'])
    expect(cards[0]).toMatchObject({ price: null, officialUrl: 'https://www.ikonpass.com/' })
  })
  it('prices the regional card from a favourite resort first', () => {
    const cards = familyCards([fam('regional', ['a', 'b'])], [product('a', 'regional', 50000, 'far'), product('b', 'regional', 99900, 'home')], '2026-27', new Set(['home']))
    expect(cards[0]).toMatchObject({ name: 'b', price: { amountMinor: 99900 } })
  })
})
