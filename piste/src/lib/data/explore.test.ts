import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as s from '@/lib/db/schema'
import { provenance } from '@/lib/domain/types'
import { getCompareView, getEventsView, getExploreView, regionGroup } from './explore'
import { buildFixture, TODAY, type Fixture } from './fixtures.test-helpers'

let fx: Fixture
beforeAll(async () => {
  fx = await buildFixture()
  const prov = provenance({ kind: 'manual', provider: 'Piste catalog', fetchedAt: '2026-09-28T12:00:00.000Z', verification: 'search-summary' })
  await fx.db.insert(s.events).values([
    {
      id: 'peak-fest',
      resortId: 'test-peak',
      title: 'Peak Fest',
      category: 'festival',
      venue: 'test-peak resort base lodge',
      startLocal: '2027-01-16T18:00',
      endLocal: '2027-01-16T22:00',
      timezone: 'America/New_York',
      status: 'announced',
      priceMinor: 0,
      currency: 'USD',
      dedupeKey: 'peak-fest',
      lastVerifiedAt: '2027-01-10T12:00:00.000Z',
      prov,
    },
    {
      id: 'pond-skim',
      resortId: 'test-peak',
      title: 'Pond Skim',
      category: 'competition',
      venue: 'Somewhere else',
      startLocal: null,
      endLocal: null,
      timezone: 'America/New_York',
      status: 'not-announced',
      lastEdition: 'Sat Apr 4, 2026',
      dedupeKey: 'pond-skim',
      prov,
    },
  ])
  await fx.db.insert(s.trips).values([
    { id: 'jan-trip', name: 'January weekend', status: 'draft', startDate: '2027-01-16', endDate: '2027-01-17', partySize: 2, companions: [], createdAt: TODAY, updatedAt: TODAY },
    { id: 'old-trip', name: 'Old trip', status: 'draft', startDate: '2027-01-01', endDate: '2027-01-02', partySize: 1, companions: [], createdAt: TODAY, updatedAt: TODAY },
    { id: 'off-trip', name: 'Cancelled trip', status: 'cancelled', startDate: '2027-02-01', endDate: '2027-02-02', partySize: 1, companions: [], createdAt: TODAY, updatedAt: TODAY },
  ])
})

describe('regionGroup', () => {
  it('groups by broad region', () => {
    expect(regionGroup('US', 'NY')).toBe('Northeast US')
    expect(regionGroup('US', 'UT')).toBe('Western US')
    expect(regionGroup('CA', 'BC')).toBe('Western Canada')
    expect(regionGroup('AT', null)).toBe('Europe')
  })
})

describe('getExploreView', () => {
  it('keeps unknowns unknown in the facets the filters use', async () => {
    const v = await getExploreView(fx.ctx, { date: TODAY })
    const by = Object.fromEntries(v.rows.map((r) => [r.facets.id, r]))
    expect(v.rows).toHaveLength(4)

    // A reported temporary closure today is a confirmed closure: no ski-day score, never "open".
    expect(by['expert-bowl'].facets).toMatchObject({ status: 'temporarily-closed', closedOnDate: true, scoreKind: 'closed', score: null })
    expect(by['expert-bowl'].card.closure).not.toBeNull()

    // No status recorded → unknown (never open), and no assessment → no score.
    expect(by['quiet-hill'].facets).toMatchObject({ status: 'unknown', scoreKind: 'none', score: null })

    // A fly-in destination has no drive time rather than a made-up one.
    expect(by['far-west'].facets).toMatchObject({ travelMode: 'fly', driveMinutes: null })
    expect(by['far-west'].card.travel).toMatchObject({ mode: 'fly', headline: 'Fly' })

    // The owned Indy Base Pass (2 days, 1 used) is usable at test-peak today; far-west's Ikon access is unconfirmed.
    expect(by['test-peak'].facets.ownedCanSki).toBe(true)
    expect(by['test-peak'].facets.products.find((p) => p.id === 'indy-base-2026-27')).toMatchObject({ canSki: true })
    expect(by['far-west'].facets.families).toEqual([{ id: 'ikon', confirmed: false }])
    expect(by['far-west'].card.passes[0]).toMatchObject({ familyId: 'ikon', confirmed: false })
    expect(by['far-west'].card.passes[0].title).toMatch(/2026–27 access unconfirmed/)

    expect(v.counts).toMatchObject({ total: 4, statusUnknown: 1 })
    expect(v.preseason).toBe(false)
    expect(v.owned).toEqual([{ productId: 'indy-base-2026-27', name: 'Indy Base Pass' }])
  })

  it('counts events in the ±3-day window and falls back to today for dates outside the season', async () => {
    const v = await getExploreView(fx.ctx, { date: TODAY })
    expect(v.rows.find((r) => r.facets.id === 'test-peak')!.facets.eventsInWindow).toBe(1)
    const outside = await getExploreView(fx.ctx, { date: '2031-01-01' })
    expect(outside.date).toBe(TODAY)
    expect(outside.quickDates.map((q) => q.label)).toEqual(['Today', 'Sat 16', 'Sun 17'])
  })
})

describe('getCompareView', () => {
  it('reports unknown and dropped ids and never ranks a closure or an unknown', async () => {
    const v = await getCompareView(fx.ctx, { ids: ['test-peak', 'far-west', 'expert-bowl', 'nope', 'quiet-hill', 'extra'], date: TODAY, party: 99 })
    expect(v.columns.map((c) => c.id)).toEqual(['test-peak', 'far-west', 'expert-bowl'])
    expect(v.missingIds).toEqual(['nope'])
    expect(v.droppedIds).toEqual(['quiet-hill', 'extra'])
    expect(v.party).toBe(12)
    // 78 (test-peak) beats 72 (far-west); expert-bowl's model score is superseded by the closure.
    expect(v.best.score).toBe('test-peak')
    expect(v.columns.find((c) => c.id === 'expert-bowl')!.score).toMatchObject({ kind: 'closed', value: null })
    // Only test-peak and expert-bowl have drive times; far-west is a fly-in (never ranked as 0).
    expect(v.best.drive).toBe('test-peak')
    expect(v.columns.find((c) => c.id === 'far-west')!.travel.drive).toBeNull()
  })

  it('checks the owned pass by default and a chosen product when asked', async () => {
    const mine = await getCompareView(fx.ctx, { ids: ['test-peak', 'far-west'], date: TODAY })
    expect(mine.columns[0].access.rows[0]).toMatchObject({ productId: 'indy-base-2026-27', owned: true, canSki: true })
    const chosen = await getCompareView(fx.ctx, { ids: ['test-peak', 'far-west'], date: TODAY, productId: 'ikon-base-2026-27' })
    expect(chosen.product).toEqual({ id: 'ikon-base-2026-27', name: 'Ikon Base Pass' })
    expect(chosen.columns[1].access.rows[0]).toMatchObject({ productId: 'ikon-base-2026-27', owned: false, status: 'unknown', canSki: false })
  })
})

describe('getEventsView', () => {
  it('never invents dates, and only dated events can be exported', async () => {
    const v = await getEventsView(fx.ctx)
    const fest = v.events.find((e) => e.id === 'peak-fest')!
    const skim = v.events.find((e) => e.id === 'pond-skim')!
    expect(fest).toMatchObject({ dated: true, startDate: '2027-01-16', price: 'Free', priceKind: 'free', icsUrl: '/api/export/ics?event=peak-fest' })
    expect(fest.timeLabel).toBe('18:00–22:00 EST')
    expect(skim).toMatchObject({ dated: false, startDate: null, whenLabel: 'Dates not announced yet', icsUrl: null, price: null, priceKind: 'unknown', distance: 'unknown' })
    expect(skim.lastEdition).toBe('Sat Apr 4, 2026')
    // Dated events first, then the watch list.
    expect(v.events.map((e) => e.id)).toEqual(['peak-fest', 'pond-skim'])
  })

  it('offers only upcoming, non-cancelled trips', async () => {
    const v = await getEventsView(fx.ctx)
    expect(v.trips.map((t) => t.id)).toEqual(['jan-trip'])
    expect(v.trips[0].label).toBe('16 Jan – 17 Jan 2027')
  })
})
