import { describe, expect, it } from 'vitest'
import { avatarOf, dataUrlBytes, DEFAULT_AVATAR, gearCoverage, unwearItem, wearItem } from './gear'

describe('gearCoverage', () => {
  it('an empty locker owns nothing and rents the full package', () => {
    expect(gearCoverage([])).toMatchObject({ empty: true, suggestedRental: 'full-package', packing: [], toRent: ['Skis', 'Boots', 'Poles', 'Helmet'] })
  })

  it('suggests the rental basket from what is owned', () => {
    expect(gearCoverage([{ type: 'boots', brandModel: 'B' }]).suggestedRental).toBe('skis-only')
    expect(gearCoverage([{ type: 'skis', brandModel: 'S' }]).suggestedRental).toBe('boots-only')
    expect(gearCoverage([{ type: 'snowboard', brandModel: 'Board' }, { type: 'boots', brandModel: 'B' }])).toMatchObject({ suggestedRental: 'none', toRent: ['Helmet'] })
    expect(gearCoverage([{ type: 'jacket', brandModel: 'J' }])).toMatchObject({ empty: false, suggestedRental: 'full-package' })
  })

  it('lists packing lines in a stable kit order', () => {
    const c = gearCoverage([
      { type: 'gloves', brandModel: 'G' },
      { type: 'skis', brandModel: 'S' },
      { type: 'helmet', brandModel: 'H' },
    ])
    expect(c.packing.map((p) => p.label)).toEqual(['Skis — S', 'Helmet — H', 'Gloves — G'])
  })
})

describe('avatar prefs', () => {
  it('fills defaults for a missing or partial row', () => {
    expect(avatarOf(null)).toEqual(DEFAULT_AVATAR)
    expect(avatarOf({ look: 'holo', colors: { jacket: '#c8502a' } as never })).toMatchObject({ look: 'holo', colors: { jacket: '#c8502a', pants: DEFAULT_AVATAR.colors.pants }, poles: true })
  })

  it('wearing copies the colour and shows backpacks; unwearing only forgets the item', () => {
    const a = wearItem(avatarOf(null), { id: 7, type: 'backpack', color: '#2f5d46' })
    expect(a).toMatchObject({ backpack: true, colors: { backpack: '#2f5d46' }, wearing: { backpack: 7 } })
    expect(unwearItem(a, 7)).toMatchObject({ backpack: true, colors: { backpack: '#2f5d46' }, wearing: {} })
    expect(wearItem(a, { id: 8, type: 'other', color: '#000000' })).toBe(a)
  })

  it('measures data-URL payloads', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3)
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1)
  })
})
