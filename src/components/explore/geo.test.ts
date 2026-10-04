import { describe, expect, it } from 'vitest'
import {
  availableJumps,
  boundsOf,
  clampCamera,
  clusterCaption,
  clusterRect,
  clusterPoints,
  fitCamera,
  flyFrame,
  formatLat,
  formatLon,
  inJump,
  jumpOf,
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
    // Only labels and count badges are solid; a bare dot (a marker that gave up its label) may sit under a label.
    const boxes = c.filter((x) => !(x.members.length === 1 && x.side === 'dot')).map((x) => clusterRect(x)!)
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
    expect(c.side).toBe('left')
  })

  it('captions a bubble with its lead name, both names when two short ones fit', () => {
    expect(clusterCaption(['Zermatt', 'Val Thorens', 'Kitzbühel'])).toBe('Zermatt')
    expect(clusterCaption(['Alta', 'Snowbird'])).toBe('Alta · Snowbird')
    expect(clusterCaption(['Garmisch-Partenkirchen', 'Kitzsteinhorn'])).toBe('Garmisch-Partenkirchen')
  })

  it('names a bubble after its highest-priority member, then the list order', () => {
    const c = clusterPoints([pt('b', 100, 100, 'Bbb'), { ...pt('a', 110, 104, 'Aaa'), priority: 1 }, pt('c', 120, 98, 'Ccc')])
    expect(c).toHaveLength(1)
    expect(c[0].lead.id).toBe('a')
    const d = clusterPoints([pt('b', 100, 100, 'Bbb'), pt('a', 110, 104, 'Aaa')])
    expect(d[0].lead.id).toBe('b')
  })

  it('moves labels off panels, or drops them to a dot, and hides markers under a panel', () => {
    const panel = { l: 200, t: 0, r: 400, b: 400 }
    const [flipped] = clusterPoints([pt('a', 150, 100, 'Long resort name')], { obstacles: [panel] })
    expect(flipped.side).toBe('left')
    const [dot] = clusterPoints([pt('b', 150, 100, 'Long resort name')], { obstacles: [panel, { l: 0, t: 0, r: 130, b: 400 }] })
    expect(dot.side).toBe('dot')
    const [hidden] = clusterPoints([pt('c', 300, 100, 'Under the panel')], { obstacles: [panel] })
    expect(hidden.side).toBe('hidden')
    expect(clusterRect(hidden)).toBeNull()
  })

  it('never merges the selection into a bubble', () => {
    const c = clusterPoints([{ ...pt('sel', 100, 100, 'Selected'), priority: 3 }, pt('n1', 112, 104, 'Neighbour one'), pt('n2', 118, 96, 'Neighbour two')])
    const sel = c.find((x) => x.members.some((m) => m.id === 'sel'))!
    expect(sel.members).toHaveLength(1)
    expect(sel.side).toBe('right')
    for (const x of c.filter((x) => x !== sel)) expect(x.side).toBe('dot')
  })

  it('groups markers crowded by a far-away label into one count badge instead of a pile of dots', () => {
    // A long label running right from x=0 covers a tight group of five points 120 px away.
    const far = { ...pt('far', 0, 100, 'A very very long resort label'), priority: 1 }
    const group = Array.from({ length: 5 }, (_, i) => pt(`g${i}`, 120 + i * 3, 104 + i * 2, `Group resort ${i}`))
    const c = clusterPoints([far, ...group])
    const g = c.find((x) => x.members.some((m) => m.id === 'g0'))!
    expect(g.members).toHaveLength(5)
    expect(['dot', 'right', 'left']).toContain(g.side)
    expect(c.find((x) => x.members[0].id === 'far')!.members).toHaveLength(1)
  })

  it('does not merge far-apart markers whose labels collide: the later one drops its label', () => {
    // Two long labels on one row, 150 px apart: they collide, but a bubble halfway between them would be wrong.
    const c = clusterPoints([pt('a', 100, 100, 'A very long resort name here'), pt('b', 250, 102, 'Another long resort name')])
    expect(c).toHaveLength(2)
    expect(c.find((x) => x.members[0].id === 'a')!.side).toBe('right')
    expect(c.find((x) => x.members[0].id === 'b')!.side).toBe('dot')
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
