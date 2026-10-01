/**
 * Generic hero art for resorts without bundled pictures: layered ridgelines and contour lines drawn from the
 * resort's id (so each resort keeps its own shape) and its real vertical drop (so a 300 m hill reads as rolling and a
 * 2,000 m area as alpine). It is decorative — never presented as the resort's terrain, a map or a photo.
 * Pure: no React, no DOM.
 */

export const ART_W = 1280
export const ART_H = 520

export interface TerrainLayer {
  /** Closed silhouette path (ridge, then down to the bottom edge). */
  fill: string
  /** Open ridge polyline points ("x,y x,y …"). */
  ridge: string
}

export interface TerrainArtSpec {
  far: TerrainLayer
  back: TerrainLayer
  mid: TerrainLayer
  front: TerrainLayer
  /** Contour lines under the front ridge (clip them with the front silhouette). */
  contours: string[]
  /** Highest point of the front ridge, in art units. */
  peak: { x: number; y: number }
  /** A low point on the front ridge for the base label. */
  foot: { x: number; y: number }
  /** 0 (rolling hills) … 1 (high alpine). */
  relief: number
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STEP = 8
const round = (n: number) => Math.round(n * 10) / 10

interface RidgeOpts {
  peakX: number
  /** Top of the main peak (art units from the top). */
  top: number
  /** Ridge height at the edges. */
  edge: number
  /** Half-width of the main massif. */
  width: number
  /** 1 = soft bell, higher = sharper summit. */
  sharp: number
  rough: number
}

function ridgeYs(rand: () => number, o: RidgeOpts): number[] {
  const waves = Array.from({ length: 5 }, (_, i) => ({ f: (0.004 + rand() * 0.01) * (i + 1), p: rand() * Math.PI * 2, a: (1 / (i + 1.4)) * o.rough }))
  const side = { x: o.peakX + (rand() > 0.5 ? 1 : -1) * (o.width * (0.7 + rand() * 0.5)), h: 0.45 + rand() * 0.25 }
  const ys: number[] = []
  for (let x = 0; x <= ART_W; x += STEP) {
    const d = Math.abs(x - o.peakX) / o.width
    const main = o.sharp > 1.4 ? Math.max(0, 1 - d) ** o.sharp : Math.exp(-(d * d) * 1.6)
    const ds = Math.abs(x - side.x) / (o.width * 0.6)
    const second = side.h * Math.exp(-(ds * ds) * 1.8)
    const lift = Math.max(main, second)
    let noise = 0
    for (const w of waves) noise += Math.sin(x * w.f + w.p) * w.a
    // Jagged crest for alpine relief, smooth for hills.
    const jag = o.sharp > 1.4 ? (rand() - 0.5) * 9 * lift : 0
    ys.push(o.edge - (o.edge - o.top) * lift + noise * 14 + jag)
  }
  return ys
}

function layer(ys: number[]): TerrainLayer {
  const pts = ys.map((y, i) => `${i * STEP},${round(y)}`)
  return { ridge: pts.join(' '), fill: `M0,${ART_H} L${pts.join(' L')} L${ART_W},${ART_H} Z` }
}

export function terrainArt(seed: string, verticalM: number | null, summitM: number | null = null): TerrainArtSpec {
  const rand = rng(seed || 'piste')
  // Relief from the real vertical drop and summit height; unknown draws a middling shape rather than a dramatic one.
  const byVertical = ((verticalM ?? 500) - 150) / 1600
  const bySummit = summitM !== null ? (summitM - 1100) / 2200 : 0
  const relief = Math.max(0.15, Math.min(1, Math.max(byVertical, bySummit)))
  const sharp = 1 + relief * 1.6
  const frontTop = 200 - relief * 150
  const peakX = 470 + rand() * 340
  const front = ridgeYs(rand, { peakX, top: frontTop, edge: 420 - relief * 40, width: 300 + (1 - relief) * 260, sharp, rough: 0.8 + relief })
  const mid = ridgeYs(rand, { peakX: peakX + (rand() > 0.5 ? 1 : -1) * (220 + rand() * 160), top: frontTop + 25, edge: 330, width: 340, sharp: Math.max(1, sharp - 0.3), rough: 1 })
  const back = ridgeYs(rand, { peakX: rand() * ART_W, top: frontTop - 10, edge: 270, width: 420, sharp: Math.max(1, sharp - 0.6), rough: 1.2 })
  const far = ridgeYs(rand, { peakX: rand() * ART_W, top: Math.max(30, frontTop - 50), edge: 220, width: 520, sharp: Math.max(1, sharp - 0.8), rough: 1.4 })

  let pi = 0
  front.forEach((y, i) => {
    if (y < front[pi]) pi = i
  })
  // Base label sits at the lowest front point well away from the summit.
  let fi = pi < front.length / 2 ? front.length - 6 : 5
  for (let i = 0; i < front.length; i++) if (Math.abs(i - pi) > front.length * 0.3 && front[i] > front[fi]) fi = i

  const contours: string[] = []
  for (let k = 1; k <= 16; k++) {
    const gap = 9 + k * 2.2
    const pts = front.map((y, i) => {
      const x = i * STEP
      return `${x},${round(y + k * gap + Math.sin(x * 0.011 + k * 1.7) * (3 + k * 0.6))}`
    })
    contours.push(pts.join(' '))
  }

  return {
    far: layer(far),
    back: layer(back),
    mid: layer(mid),
    front: layer(front),
    contours,
    peak: { x: pi * STEP, y: round(front[pi]) },
    foot: { x: fi * STEP, y: round(front[fi]) },
    relief,
  }
}
