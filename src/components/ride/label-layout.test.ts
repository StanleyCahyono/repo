import { describe, expect, it } from 'vitest'
import { overlapArea, placeLabels } from './label-layout'

const bounds = { x: 0, y: 0, w: 800, h: 600 }

describe('placeLabels', () => {
  it('puts a lone label above its pin, in whole pixels', () => {
    const [p] = placeLabels([{ id: 'a', x: 400.4, y: 300.6, w: 81, h: 25, gap: 12 }], bounds)
    expect(p.place).toBe('top')
    expect(Number.isInteger(p.rect.x) && Number.isInteger(p.rect.y)).toBe(true)
  })

  it('moves a second label off a crowded spot (home vs a nearby airport)', () => {
    const out = placeLabels(
      [
        { id: 'home', x: 400, y: 300, w: 90, h: 26, gap: 12 },
        { id: 'ith', x: 410, y: 292, w: 60, h: 26, gap: 10 },
      ],
      bounds,
    )
    expect(overlapArea(out[0].rect, out[1].rect)).toBe(0)
  })

  it('keeps labels inside the bounds at the edges', () => {
    const [p] = placeLabels([{ id: 'z', x: 790, y: 300, w: 90, h: 26, gap: 12 }], bounds)
    expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(800)
    expect(p.place).toBe('left')
  })
})
