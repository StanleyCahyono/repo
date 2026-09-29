import { describe, expect, it } from 'vitest'
import type { EventItem, TripOption } from '@/lib/data/explore'
import {
  DEFAULT_EVENT_FILTERS,
  eventFiltersToParams,
  eventsOn,
  groupByMonth,
  initialMonth,
  monthGrid,
  overlaps,
  parseEventFilters,
  selectEvents,
  shiftMonth,
  windowFor,
  type EventFilters,
} from './events-filters'

function ev(p: Partial<EventItem> & { id: string }): EventItem {
  const dated = p.startDate !== undefined ? p.startDate !== null : false
  return {
    title: p.id,
    category: 'festival',
    categoryLabel: 'Festival',
    resort: { id: 'greek-peak', name: 'Greek Peak Mountain Resort', shortName: 'Greek Peak', region: 'Central New York' },
    venue: null,
    status: dated ? 'announced' : 'not-announced',
    statusLabel: dated ? 'Announced' : 'Dates not announced yet',
    dated,
    startDate: null,
    endDate: null,
    whenLabel: '',
    timeLabel: null,
    timezone: 'America/New_York',
    price: null,
    priceKind: 'unknown',
    ageRestriction: null,
    bookingRequired: null,
    officialUrl: null,
    ticketUrl: null,
    lastVerifiedAt: null,
    lastEdition: null,
    distance: 'unknown',
    prov: null,
    icsUrl: null,
    ...p,
  }
}

const ctx = {
  today: '2026-09-29',
  seasonBounds: { min: '2026-07-01', max: '2027-06-30' },
  trips: [{ id: 'feb', name: 'Alta', startDate: '2027-02-13', endDate: '2027-02-17', status: 'draft', label: '13 Feb – 17 Feb 2027' }] as TripOption[],
}
const f = (p: Partial<EventFilters>): EventFilters => ({ ...DEFAULT_EVENT_FILTERS, ...p })

describe('event URL state', () => {
  it('round-trips and omits defaults', () => {
    expect(eventFiltersToParams(DEFAULT_EVENT_FILTERS).toString()).toBe('')
    const full = f({
      view: 'calendar',
      when: 'custom',
      from: '2027-01-01',
      to: '2027-01-31',
      resort: 'alta',
      cats: ['music', 'race'],
      price: 'free',
      month: '2027-01',
    })
    expect(parseEventFilters(eventFiltersToParams(full))).toEqual(full)
  })

  it('drops keys that do not apply and rejects junk', () => {
    expect(eventFiltersToParams(f({ when: 'upcoming', from: '2027-01-01', trip: 'feb', month: '2027-01' })).toString()).toBe('')
    const p = parseEventFilters(new URLSearchParams('when=soon&price=cheap&from=2027-02-30&month=2027-13&cat=Music!,race'))
    expect(p).toMatchObject({ when: 'upcoming', price: 'any', from: null, month: null, cats: ['race'] })
  })
})

describe('windows', () => {
  it('upcoming runs from today to the end of the season', () => {
    expect(windowFor(f({}), ctx)).toMatchObject({ from: '2026-09-29', to: '2027-06-30' })
  })
  it('trip windows use the trip dates, and fall back when the trip is gone', () => {
    expect(windowFor(f({ when: 'trip', trip: 'feb' }), ctx)).toMatchObject({ from: '2027-02-13', to: '2027-02-17' })
    expect(windowFor(f({ when: 'trip', trip: 'nope' }), ctx)).toMatchObject({ from: '2026-09-29', to: '2027-06-30' })
  })
  it('custom windows are ordered even when entered backwards', () => {
    expect(windowFor(f({ when: 'custom', from: '2027-03-01', to: '2027-01-01' }), ctx)).toMatchObject({ from: '2027-01-01', to: '2027-03-01' })
  })
})

describe('selection', () => {
  const events = [
    ev({ id: 'fest', startDate: '2026-10-10', endDate: '2026-10-11' }),
    ev({ id: 'race', startDate: '2027-02-14', endDate: '2027-02-14', category: 'race', price: 'Free', priceKind: 'free' }),
    ev({ id: 'pond', lastEdition: 'Sat Apr 4, 2026' }),
    ev({ id: 'elsewhere', startDate: '2027-01-02', resort: { id: 'alta', name: 'Alta', shortName: 'Alta', region: 'Utah' } }),
  ]

  it('never places an undated event in a window; it is watched instead', () => {
    const s = selectEvents(events, f({ when: 'season' }), windowFor(f({ when: 'season' }), ctx))
    expect(s.dated.map((e) => e.id)).toEqual(['fest', 'elsewhere', 'race'])
    expect(s.watching.map((e) => e.id)).toEqual(['pond'])
  })

  it('trip window keeps overlapping events and counts the rest as outside', () => {
    const w = windowFor(f({ when: 'trip', trip: 'feb' }), ctx)
    const s = selectEvents(events, f({ when: 'trip', trip: 'feb' }), w)
    expect(s.dated.map((e) => e.id)).toEqual(['race'])
    expect(s.outside.map((e) => e.id)).toEqual(['fest', 'elsewhere'])
  })

  it('resort, category and price filters apply to watched events too', () => {
    const w = windowFor(f({ when: 'season' }), ctx)
    expect(selectEvents(events, f({ when: 'season', resort: 'alta' }), w).watching).toEqual([])
    expect(selectEvents(events, f({ when: 'season', cats: ['race'] }), w).dated.map((e) => e.id)).toEqual(['race'])
    const unknownPrice = selectEvents(events, f({ when: 'season', price: 'unknown' }), w)
    expect(unknownPrice.dated.map((e) => e.id)).toEqual(['fest', 'elsewhere'])
    expect(unknownPrice.watching.map((e) => e.id)).toEqual(['pond'])
  })

  it('multi-day events overlap every day they span', () => {
    expect(overlaps(events[0], '2026-10-11', '2026-10-11')).toBe(true)
    expect(overlaps(events[0], '2026-10-12', '2026-10-20')).toBe(false)
    expect(eventsOn(events, '2026-10-11').map((e) => e.id)).toEqual(['fest'])
    expect(overlaps(events[2], '2026-01-01', '2027-12-31')).toBe(false)
  })

  it('groups by start month', () => {
    expect(groupByMonth(events).map((g) => [g.month, g.label, g.events.length])).toEqual([
      ['2026-10', 'October 2026', 1],
      ['2027-01', 'January 2027', 1],
      ['2027-02', 'February 2027', 1],
    ])
  })
})

describe('calendar helpers', () => {
  it('shiftMonth crosses years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2026-10', 15)).toBe('2028-01')
  })

  it('monthGrid covers whole Monday-first weeks', () => {
    const g = monthGrid('2026-10') // 1 Oct 2026 is a Thursday
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g[0][0]).toEqual({ date: '2026-09-28', inMonth: false })
    expect(g[0][3]).toEqual({ date: '2026-10-01', inMonth: true })
    expect(g[g.length - 1][6].date).toBe('2026-11-01')
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31)
    expect(monthGrid('2027-02')).toHaveLength(4) // Feb 2027 starts on a Monday and has 28 days
  })

  it('initialMonth prefers the URL, then the first dated event, then the window start', () => {
    expect(initialMonth(f({ month: '2027-03' }), [], { from: '2026-09-29' })).toBe('2027-03')
    expect(initialMonth(f({}), [ev({ id: 'x', startDate: '2026-10-10' })], { from: '2026-09-29' })).toBe('2026-10')
    expect(initialMonth(f({}), [], { from: '2026-09-29' })).toBe('2026-09')
  })
})
