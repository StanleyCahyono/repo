import { describe, expect, it } from 'vitest'
import { baseVillageName, layoutLabels, type MapPlaceLabel } from './map-labels'

const place = (id: string, kind: MapPlaceLabel['kind'], x: number, y: number, eleM: number | null = null): MapPlaceLabel => ({
  id,
  name: id,
  kind,
  lon: x,
  lat: y,
  ele: eleM === null ? null : `${eleM} m`,
  eleM,
})
const opts = (extra: Partial<Parameters<typeof layoutLabels>[1]> = {}) => ({
  project: (p: MapPlaceLabel) => [p.lon, p.lat] as [number, number],
  measure: (text: string, size: number) => text.length * size * 0.6,
  width: 400,
  height: 300,
  zoom: 1,
  ...extra,
})

describe('layoutLabels', () => {
  it('never overlaps two labels and keeps the higher-priority one', () => {
    const out = layoutLabels([place('Hamletville', 'hamlet', 100, 100), place('Town', 'town', 102, 100)], opts({ zoom: 3 }))
    expect(out[0].place.id).toBe('Town')
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i].box
        const b = out[j].box
        expect(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true)
      }
  })

  it('shows stations and hamlets only when zoomed in', () => {
    const ps = [place('Station', 'station', 100, 100, 2900), place('Hamlet', 'hamlet', 250, 200)]
    expect(layoutLabels(ps, opts()).length).toBe(0)
    expect(layoutLabels(ps, opts({ zoom: 3 })).length).toBe(2)
  })

  it('avoids obstacles and the frame edge', () => {
    const out = layoutLabels([place('Peak', 'peak', 390, 150, 4000)], opts())
    expect(out[0]?.side).toBe('left')
    expect(layoutLabels([place('Peak', 'peak', 200, 150, 4000)], opts({ obstacles: [{ l: 150, t: 100, r: 250, b: 200 }] }))).toEqual([])
  })
})

describe('baseVillageName', () => {
  it('takes the first place of the catalog locality', () => {
    expect(baseVillageName('Zermatt (car-free), linked with Breuil-Cervinia and Valtournenche in Italy')).toBe('Zermatt')
    expect(baseVillageName('Kutchan and Niseko towns: Grand Hirafu, Hanazono')).toBe('Kutchan')
    expect(baseVillageName('Hakuba village (Happo)')).toBe('Hakuba')
    expect(baseVillageName('Alta, UT (head of Little Cottonwood Canyon, SR-210)')).toBe('Alta')
    expect(baseVillageName(null)).toBeNull()
  })
})
