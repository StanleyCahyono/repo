import { describe, expect, it } from 'vitest'
import {
  availableJumps,
  boundsOf,
  clampCamera,
  clusterCaption,
  clusterPoints,
  fitCamera,
  flyFrame,
  formatLat,
  formatLon,
  inJump,
  jumpOf,
  labelBox,
  latOf,
  lonOf,
  mx,
  my,
  project,
  unproject,
} from './geo'

describe('mercator', () => {
  it('round-trips coordinates', () => {
    for (const [lon, lat] of [
      [-76.5, 42.44],
      [7.75, 46.02],
      [168.9, -44.9],
    ]) {
      expect(lonOf(mx(lon))).toBeCloseTo(lon, 6)
      expect(latOf(my(lat))).toBeCloseTo(lat, 6)
    }
  })

  it('projects the camera centre to the middle of the viewport and back', () => {
    const cam = { lon: 7.7, lat: 46, zoom: 6 }
    expect(project(7.7, 46, cam, 800, 600)).toEqual({ x: 400, y: 300 })
    const at = unproject(123, 456, cam, 800, 600)
    const back = project(at.lon, at.lat, cam, 800, 600)
    expect(back.x).toBeCloseTo(123, 6)
    expect(back.y).toBeCloseTo(456, 6)
  })
})

describe('fitCamera', () => {
  const b = boundsOf([
    { lon: -80.4, lat: 41.6 },
    { lon: -71.8, lat: 44.95 },
  ])!

  it('keeps every point inside the padded area', () => {
    const pad = { top: 100, right: 456, bottom: 120, left: 24 }
    const cam = fitCamera(b, 1342, 690, pad, { maxZoom: 9 })
    const sw = project(b[0], b[1], cam, 1342, 690)
    const ne = project(b[2], b[3], cam, 1342, 690)
    expect(sw.x).toBeGreaterThanOrEqual(pad.left - 0.5)
    expect(ne.x).toBeLessThanOrEqual(1342 - pad.right + 0.5)
    expect(ne.y).toBeGreaterThanOrEqual(pad.top - 0.5)
    expect(sw.y).toBeLessThanOrEqual(690 - pad.bottom + 0.5)
  })

  it('respects maxZoom for a single point', () => {
    const cam = fitCamera([7, 46, 7, 46], 800, 600, { top: 0, right: 0, bottom: 0, left: 0 }, { maxZoom: 7 })
    expect(cam.zoom).toBe(7)
  })
})

describe('flyFrame', () => {
  it('starts and ends on the two cameras and pulls back mid-flight on long hops', () => {
    const a = { lon: -76, lat: 43, zoom: 6 }
    const z = { lon: 9, lat: 46.5, zoom: 6 }
    expect(flyFrame(a, z, 0).lon).toBeCloseTo(-76, 6)
    const end = flyFrame(a, z, 1)
    expect(end.lon).toBeCloseTo(9, 6)
    expect(end.zoom).toBeCloseTo(6, 6)
    expect(flyFrame(a, z, 0.5).zoom).toBeLessThan(6)
  })
})

describe('clampCamera', () => {
  it('never shows space above the top of the world', () => {
    const c = clampCamera({ lon: 0, lat: 84, zoom: 2 }, 600)
    expect(project(0, 85.0511, c, 800, 600).y).toBeLessThanOrEqual(0.01)
  })
})

describe('region jumps', () => {
  it('only offers regions the catalog has, World first', () => {
    const jumps = availableJumps(['Northeast US', 'Austria', 'Switzerland', 'Japan'])
    expect(jumps.map((j) => j.def.key)).toEqual(['world', 'northeast', 'alps', 'japan'])
    expect(jumps.find((j) => j.def.key === 'alps')?.count).toBe(2)
  })

  it('falls back to World for unknown keys', () => {
    expect(jumpOf('nowhere').key).toBe('world')
    expect(inJump(jumpOf('world'), 'Japan')).toBe(true)
    expect(inJump(jumpOf('alps'), 'Japan')).toBe(false)
  })
})

describe('clusterPoints', () => {
  const pt = (id: string, x: number, y: number, name = id) => ({ id, name, x, y })

  it('keeps far-apart markers separate', () => {
    const c = clusterPoints([pt('a', 0, 0), pt('b', 400, 0), pt('c', 0, 300)])
    expect(c).toHaveLength(3)
    expect(c.every((x) => x.members.length === 1)).toBe(true)
  })

  it('merges markers whose labels would overlap', () => {
    const c = clusterPoints([pt('zermatt', 100, 100, 'Zermatt'), pt('saas-fee', 130, 108, 'Saas-Fee'), pt('far', 600, 400, 'Far')])
    expect(c).toHaveLength(2)
    const merged = c.find((x) => x.members.length === 2)!
    expect(merged.members.map((m) => m.id).sort()).toEqual(['saas-fee', 'zermatt'])
    expect(merged.key).toBe('c:saas-fee,zermatt')
  })

  it('leaves no two resulting labels overlapping', () => {
    const pts = Array.from({ length: 60 }, (_, i) => pt(`r${i}`, (i * 37) % 500, (i * 53) % 300, `Resort number ${i}`))
    const c = clusterPoints(pts)
    expect(c.reduce((a, x) => a + x.members.length, 0)).toBe(60)
    const boxes = c.map((x) => {
      const w = x.members.length === 1 ? labelBox(x.members[0].name).w : 44 + clusterCaption(x.members.map((m) => m.name)).length * 6.9
      const inset = x.members.length === 1 ? 14 : 17
      const l = x.flip ? x.x + inset - w : x.x - inset
      return { l, r: l + w, t: x.y - 17, b: x.y + 17 }
    })
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.l < b.r && b.l < a.r && a.t < b.b - 6 && b.t < a.b - 6
        expect(overlap).toBe(false)
      }
  })

  it('flips labels that would cross the right edge', () => {
    const [c] = clusterPoints([pt('edge', 790, 100, 'Edge resort')], { maxX: 800 })
    expect(c.flip).toBe(true)
  })

  it('captions clusters with the first two names', () => {
    expect(clusterCaption(['Zermatt', 'Val Thorens', 'Kitzbühel'])).toBe('Zermatt, Val…')
  })
})

describe('HUD formatting', () => {
  it('formats hemispheres', () => {
    expect(formatLat(42.44)).toBe('42.44°N')
    expect(formatLat(-36.5, 0)).toBe('37°S')
    expect(formatLon(-76.5)).toBe('76.50°W')
    expect(formatLon(190, 0)).toBe('170°W')
  })
})
