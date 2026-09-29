import { describe, expect, it } from 'vitest'
import type { ExploreFacets } from '@/lib/data/explore'
import {
  DEFAULT_FILTERS,
  activeChips,
  activeCount,
  applyFilters,
  checks,
  clearFilters,
  countWith,
  filtersToParams,
  groupRows,
  parseFilters,
  sortRows,
  statusBucket,
  unknownReasons,
  type ExploreFilters,
} from './filters'

function facets(p: Partial<ExploreFacets> & { id: string }): { facets: ExploreFacets } {
  return {
    facets: {
      name: p.id,
      region: 'Central New York',
      regionGroup: 'Northeast US',
      isFavorite: false,
      status: 'unknown',
      closedOnDate: false,
      scoreKind: 'none',
      score: null,
      driveMinutes: null,
      travelMode: 'none',
      costTier: 'incomplete',
      costMinor: null,
      fitRank: 50,
      fitScore: 50,
      fitLabel: 'Mixed fit',
      learning: 'unknown',
      families: [],
      products: [],
      ownedCanSki: null,
      night: null,
      lessons: null,
      rentals: null,
      lodging: null,
      eventsInWindow: 0,
      search: p.id,
      ...p,
    },
  }
}

const f = (p: Partial<ExploreFilters>): ExploreFilters => ({ ...DEFAULT_FILTERS, ...p })

describe('URL round trip', () => {
  it('omits defaults and keeps unrelated keys', () => {
    const p = filtersToParams(DEFAULT_FILTERS, 'date=2027-01-16&mode=powder')
    expect(p.toString()).toBe('date=2027-01-16&mode=powder')
  })

  it('round-trips every filter', () => {
    const full = f({
      q: 'peak ',
      regions: ['Vermont', 'Utah'],
      status: ['open', 'unknown'],
      hideClosed: true,
      travel: 'd120',
      minScore: 70,
      learning: 'good',
      families: ['ikon'],
      product: 'ikon-pass-2026-27',
      usable: true,
      maxTier: 2,
      night: 'yes',
      lessons: 'unknown',
      rentals: 'no',
      lodging: null,
      events: true,
      favorites: true,
      includeUnknown: true,
      sort: 'drive',
    })
    expect(parseFilters(filtersToParams(full))).toEqual(full)
  })

  it('rejects junk values', () => {
    const p = parseFilters(new URLSearchParams('score=60&cost=9&travel=d999&sort=hype&night=maybe&product=../x&status=open,bogus'))
    expect(p.minScore).toBeNull()
    expect(p.maxTier).toBeNull()
    expect(p.travel).toBeNull()
    expect(p.sort).toBe('fit')
    expect(p.night).toBeNull()
    expect(p.product).toBeNull()
    expect(p.status).toEqual(['open'])
  })

  it('reads Next searchParams records too', () => {
    expect(parseFilters({ region: ['Vermont,Utah', 'x'], fav: '1' })).toMatchObject({ regions: ['Vermont', 'Utah'], favorites: true })
  })
})

describe('honest predicates', () => {
  it('unknown drive time is unknown; a fly-in without a drive route fails a drive filter', () => {
    const none = facets({ id: 'a', travelMode: 'none' })
    const fly = facets({ id: 'b', travelMode: 'fly' })
    const near = facets({ id: 'c', travelMode: 'drive', driveMinutes: 45 })
    const far = facets({ id: 'd', travelMode: 'fly', driveMinutes: 255 })
    const r = applyFilters([none, fly, near, far], f({ travel: 'd120' }))
    expect(r.results.map((x) => x.facets.id)).toEqual(['c'])
    expect(r.hiddenUnknown.map((x) => x.facets.id)).toEqual(['a'])
    expect(applyFilters([none, fly, near, far], f({ travel: 'd360' })).results.map((x) => x.facets.id)).toEqual(['c', 'd'])
  })

  it('tri-state features: unknown is its own answer and never "offered" or "not offered"', () => {
    const yes = facets({ id: 'y', lessons: true })
    const no = facets({ id: 'n', lessons: false })
    const unk = facets({ id: 'u', lessons: null })
    const rows = [yes, no, unk]
    expect(applyFilters(rows, f({ lessons: 'yes' })).results.map((x) => x.facets.id)).toEqual(['y'])
    expect(applyFilters(rows, f({ lessons: 'no' })).results.map((x) => x.facets.id)).toEqual(['n'])
    expect(applyFilters(rows, f({ lessons: 'unknown' })).results.map((x) => x.facets.id)).toEqual(['u'])
    const kept = applyFilters(rows, f({ lessons: 'yes', includeUnknown: true }))
    expect(kept.results.map((x) => x.facets.id)).toEqual(['y', 'u'])
    expect(kept.unknownById.get('u')).toEqual(['lessons'])
  })

  it('score filter: only complete scores pass; closures fail; partial scores are unknown', () => {
    const good = facets({ id: 'g', scoreKind: 'conditions', score: 80 })
    const low = facets({ id: 'l', scoreKind: 'conditions', score: 50 })
    const partial = facets({ id: 'p', scoreKind: 'weather-potential', score: 90 })
    const closed = facets({ id: 'c', scoreKind: 'closed', score: null })
    const r = applyFilters([good, low, partial, closed], f({ minScore: 70 }))
    expect(r.results.map((x) => x.facets.id)).toEqual(['g'])
    expect(r.hiddenUnknown.map((x) => x.facets.id)).toEqual(['p'])
  })

  it('a confirmed closure on the date overrides a reported "open"', () => {
    expect(statusBucket({ status: 'open', closedOnDate: true })).toBe('temporarily-closed')
    expect(statusBucket({ status: 'partially-open', closedOnDate: false })).toBe('open')
    const r = applyFilters([facets({ id: 'x', status: 'open', closedOnDate: true })], f({ status: ['open'] }))
    expect(r.results).toEqual([])
    expect(applyFilters([facets({ id: 'x', closedOnDate: true })], f({ hideClosed: true })).results).toEqual([])
  })

  it('pass family: unconfirmed affiliation is unknown, not a match', () => {
    const confirmed = facets({ id: 'a', families: [{ id: 'ikon', confirmed: true }] })
    const unconfirmed = facets({ id: 'b', families: [{ id: 'ikon', confirmed: false }] })
    const other = facets({ id: 'c', families: [{ id: 'epic', confirmed: true }] })
    const r = applyFilters([confirmed, unconfirmed, other], f({ families: ['ikon'] }))
    expect(r.results.map((x) => x.facets.id)).toEqual(['a'])
    expect(r.hiddenUnknown.map((x) => x.facets.id)).toEqual(['b'])
  })

  it('exact product and "usable on the date"', () => {
    const covered = facets({ id: 'a', products: [{ id: 'p', status: 'included', canSki: true, headline: '', confirmAtSource: false }] })
    const blackout = facets({ id: 'b', products: [{ id: 'p', status: 'blackout', canSki: false, headline: '', confirmAtSource: false }] })
    const unknown = facets({ id: 'c', products: [{ id: 'p', status: 'unknown', canSki: false, headline: '', confirmAtSource: true }] })
    const none = facets({ id: 'd' })
    const rows = [covered, blackout, unknown, none]
    expect(applyFilters(rows, f({ product: 'p' })).results.map((x) => x.facets.id)).toEqual(['a', 'b'])
    const usable = applyFilters(rows, f({ product: 'p', usable: true }))
    expect(usable.results.map((x) => x.facets.id)).toEqual(['a'])
    expect(usable.hiddenUnknown.map((x) => x.facets.id)).toEqual(['c'])
    // Without a product, "usable" uses the owned-pass answer (null = unconfirmed/no pass → unknown).
    const owned = applyFilters([facets({ id: 'x', ownedCanSki: true }), facets({ id: 'y', ownedCanSki: false }), facets({ id: 'z' })], f({ usable: true }))
    expect(owned.results.map((x) => x.facets.id)).toEqual(['x'])
    expect(owned.hiddenUnknown.map((x) => x.facets.id)).toEqual(['z'])
  })

  it('cost tier: incomplete estimates are unknown, never cheap', () => {
    const cheap = facets({ id: 'a', costTier: '$', costMinor: 9000 })
    const pricey = facets({ id: 'b', costTier: '$$$', costMinor: 30000 })
    const incomplete = facets({ id: 'c' })
    const r = applyFilters([cheap, pricey, incomplete], f({ maxTier: 2 }))
    expect(r.results.map((x) => x.facets.id)).toEqual(['a'])
    expect(r.hiddenUnknown.map((x) => x.facets.id)).toEqual(['c'])
  })

  it('search matches every word', () => {
    const r = checks(facets({ id: 'x', search: 'greek peak virgil ny' }).facets, f({ q: 'Peak  virgil' }))
    expect(r).toEqual([{ what: 'search', verdict: 'pass' }])
  })
})

describe('counts, chips and reasons', () => {
  const rows = [
    facets({ id: 'a', lessons: true, driveMinutes: 30, travelMode: 'drive' }),
    facets({ id: 'b', lessons: null, driveMinutes: 200, travelMode: 'drive' }),
    facets({ id: 'c', lessons: false, travelMode: 'fly' }),
  ]

  it('countWith applies a patch on top of the current filters', () => {
    const cur = f({ travel: 'd360' })
    expect(countWith(rows, cur, {})).toBe(2)
    expect(countWith(rows, cur, { lessons: 'yes' })).toBe(1)
    expect(countWith(rows, cur, { lessons: 'yes', includeUnknown: true })).toBe(2)
  })

  it('unknownReasons tallies what hides rows', () => {
    expect(unknownReasons(rows, f({ lessons: 'yes', travel: 'd360' }))).toEqual([{ what: 'lessons', count: 1 }])
  })

  it('chips remove exactly one filter', () => {
    const cur = f({ regions: ['Vermont', 'Utah'], night: 'no', usable: true })
    const chips = activeChips(cur, { family: (x) => x, product: (x) => x, dateLabel: 'Sat 16 Jan' })
    expect(chips.map((c) => c.label)).toEqual(['Vermont', 'Utah', 'Pass usable Sat 16 Jan', 'Night skiing: not offered'])
    expect(chips[0].clear(cur).regions).toEqual(['Utah'])
    expect(activeCount(cur)).toBe(3)
    expect(clearFilters(f({ q: 'alta', sort: 'name', favorites: true }))).toEqual(f({ q: 'alta', sort: 'name' }))
  })
})

describe('sorting and grouping', () => {
  it('drive sort puts known drives first, then fly-ins, then unknown', () => {
    const rows = [facets({ id: 'u' }), facets({ id: 'f', travelMode: 'fly' }), facets({ id: 'b', driveMinutes: 90 }), facets({ id: 'a', driveMinutes: 30 })]
    expect(sortRows(rows, 'drive').map((x) => x.facets.id)).toEqual(['a', 'b', 'f', 'u'])
  })

  it('score sort ranks complete scores above partial, missing and closed', () => {
    const rows = [
      facets({ id: 'closed', scoreKind: 'closed' }),
      facets({ id: 'none' }),
      facets({ id: 'partial', scoreKind: 'limited', score: 95 }),
      facets({ id: 'low', scoreKind: 'conditions', score: 60 }),
      facets({ id: 'high', scoreKind: 'conditions', score: 90 }),
    ]
    expect(sortRows(rows, 'score').map((x) => x.facets.id)).toEqual(['high', 'low', 'partial', 'none', 'closed'])
    expect(groupRows(sortRows(rows, 'score'), 'score').map((g) => g.key)).toEqual(['excellent', 'mixed', 'partial', 'none', 'closed'])
  })

  it('cost sort never treats unknown as zero', () => {
    const rows = [facets({ id: 'x' }), facets({ id: 'y', costTier: '$$', costMinor: 15000 })]
    expect(sortRows(rows, 'cost').map((r) => r.facets.id)).toEqual(['y', 'x'])
  })

  it('name sort is one ungrouped list', () => {
    expect(groupRows([facets({ id: 'b' }), facets({ id: 'a' })], 'name')).toHaveLength(1)
  })
})
