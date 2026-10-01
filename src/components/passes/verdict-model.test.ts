import { describe, expect, it } from 'vitest'
import type { CheckerView } from '@/lib/data/passes-screen'
import type { SeasonContext } from '@/lib/data/passes-hud'
import type { AccessVerdict } from '@/lib/domain/passes/types'
import { seasonLine, verdictModel } from './verdict-model'

const verdict = (o: Partial<AccessVerdict>): AccessVerdict =>
  ({ date: '2026-12-12', status: 'included', canSki: true, headline: 'Included', reasons: ['Included at Kitz.'], confirmAtSource: true, pool: null, resortCap: null, remainingDays: null, ...o }) as AccessVerdict

function view(v: AccessVerdict): CheckerView {
  return {
    season: { id: '2026-27', label: '2026–27', start: '2026-07-01', end: '2027-06-30' },
    today: '2026-10-01',
    passes: [{ key: 'product:ikon', productId: 'ikon', ownershipId: null, holder: null, name: 'Ikon Pass', familyId: 'ikon', familyName: 'Ikon Pass' }],
    resorts: [{ id: 'kitz', name: 'Kitzbühel', shortName: 'Kitzbühel', region: 'Tyrol', country: 'AT', isFavorite: false }],
    ruleResortIds: ['kitz'],
    selection: { key: 'product:ikon', productId: 'ikon', ownershipId: null, resortId: 'kitz', from: '2026-12-12', to: '2026-12-12', note: null },
    mode: 'both',
    result: { days: [{ date: '2026-12-12', verdict: v }], covered: v.canSki ? 1 : 0, byStatus: {}, resort: { id: 'kitz', shortName: 'Kitzbühel' } } as unknown as CheckerView['result'],
    byResort: null,
    byProduct: null,
    names: {},
  }
}

const ctx = (o: Partial<SeasonContext>): SeasonContext => ({ state: 'inside', opening: '2026-11-06', openingKind: 'announced', closing: '2027-04-04', closingKind: 'announced', estimateFrom: null, outside: false, ...o })

describe('verdictModel', () => {
  it('never turns an unknown rule into a yes', () => {
    const m = verdictModel(view(verdict({ status: 'unknown', canSki: false, reasons: ['Access not confirmed.'] })), ctx({}))
    expect(m.tone).toBe('unknown')
    expect(m.headline).toBe('Not confirmed')
    expect(m.detail).toContain('never permission')
  })
  it('flags covered dates outside the announced season instead of a plain yes', () => {
    const m = verdictModel(view(verdict({})), ctx({ state: 'before', outside: true }))
    expect(m.tone).toBe('outside')
    expect(m.season).toContain('before the announced opening')
  })
  it('reads the query line from the selection', () => {
    expect(verdictModel(view(verdict({})), null).query).toBe('IKON PASS · KITZBÜHEL · SAT 12 DEC 2026')
  })
})

describe('seasonLine', () => {
  it('labels an estimate as an estimate and never calls announced dates live', () => {
    expect(seasonLine(ctx({ state: 'unannounced', opening: null, openingKind: null, closing: null, closingKind: null, estimateFrom: '2026-11-28' }), 'Greek Peak', true)).toContain('an estimate')
    expect(seasonLine(ctx({}), 'Kitzbühel', true)).toContain('not a live status')
  })
})
