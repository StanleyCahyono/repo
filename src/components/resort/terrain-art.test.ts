import { describe, expect, it } from 'vitest'
import { ART_H, ART_W, terrainArt } from './terrain-art'

describe('terrainArt', () => {
  it('is deterministic per resort id', () => {
    expect(terrainArt('alta', 618, 3216)).toEqual(terrainArt('alta', 618, 3216))
    expect(terrainArt('alta', 618, 3216).front.ridge).not.toEqual(terrainArt('stowe', 618, 3216).front.ridge)
  })
  it('draws taller, sharper relief for big alpine areas than for small hills', () => {
    const hill = terrainArt('song-mountain', 210, 600)
    const alps = terrainArt('zermatt', 2359, 3883)
    expect(alps.relief).toBeGreaterThan(hill.relief)
    expect(alps.peak.y).toBeLessThan(hill.peak.y)
  })
  it('keeps the summit inside the art', () => {
    const a = terrainArt('whistler-blackcomb', 1609, 2284)
    expect(a.peak.x).toBeGreaterThanOrEqual(0)
    expect(a.peak.x).toBeLessThanOrEqual(ART_W)
    expect(a.peak.y).toBeGreaterThan(0)
    expect(a.peak.y).toBeLessThan(ART_H)
  })
})
