import { describe, expect, it } from 'vitest'
import { cityBox, cityBudget, cityVisibleAt, layoutCities, type City } from './city-labels'
import { project, rectsHit, type Camera } from './geo'

const city = (n: string, lon: number, lat: number, z: number, pop = 1e5, c = 0): City => ({ n, ll: [lon, lat], z, pop, c })

describe('city labels', () => {
  it('shows only major cities at the world view and regional towns in a region view', () => {
    expect(cityVisibleAt({ z: 2, c: 0 }, -0.5)).toBe(true)
    expect(cityVisibleAt({ z: 6, c: 0 }, 1)).toBe(false)
    // The Alps / Northeast framing sits around zoom 5–6: Innsbruck, Ithaca, Burlington (z 6) appear.
    expect(cityVisibleAt({ z: 6, c: 0 }, 5)).toBe(true)
    expect(cityVisibleAt({ z: 7, c: 0 }, 5)).toBe(false)
  })

  const cam: Camera = { lon: 10, lat: 46.5, zoom: 6 }
  const W = 1000
  const H = 700

  it('keeps clear of markers and other labels, preferring the right side', () => {
    const cities = [city('Innsbruck', 11.41, 47.28, 6), city('Zürich', 8.54, 47.37, 5, 1e6), city('Bern', 7.45, 46.95, 6, 1e5, 1)]
    const zur = project(8.54, 47.37, cam, W, H)
    const marker = { l: zur.x - 20, t: zur.y - 14, r: zur.x + 160, b: zur.y + 14 }
    const out = layoutCities(cities, cam, W, H, { blockers: [marker] })
    const names = out.map((c) => c.name)
    expect(names).toContain('Innsbruck')
    expect(names).toContain('Bern')
    // Zürich's dot is under the marker label on both sides: dropped (markers always win).
    expect(names).not.toContain('Zürich')
    expect(out.find((c) => c.name === 'Bern')!.capital).toBe(true)
    for (const c of out) {
      const p = project(c.lon, c.lat, cam, W, H)
      expect(rectsHit(cityBox(p.x, p.y, c.name.length * 6.4, c.side), marker)).toBe(false)
    }
  })

  it('drops the less important of two colliding labels', () => {
    const out = layoutCities([city('Smalltown', 10.02, 46.5, 6, 1e4), city('Bigcity', 10, 46.5, 4, 1e6)], cam, W, H, { blockers: [] })
    expect(out.map((c) => c.name)).toEqual(['Bigcity'])
  })

  it('caps the number of labels by the stage size', () => {
    expect(cityBudget(360, 340)).toBeGreaterThanOrEqual(3)
    expect(cityBudget(1440, 900)).toBeLessThanOrEqual(70)
    const many = Array.from({ length: 200 }, (_, i) => city(`C${i}`, 5 + (i % 20) * 0.5, 44 + Math.floor(i / 20) * 0.5, 5))
    expect(layoutCities(many, cam, W, H, { blockers: [], max: 10 }).length).toBeLessThanOrEqual(10)
  })
})
