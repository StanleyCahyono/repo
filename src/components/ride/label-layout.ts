/**
 * Collision-avoiding placement for map pin labels (pure numbers, no DOM). Each label may sit above, below, beside or
 * diagonally off its pin; labels are placed greedily in priority order, each taking the candidate that overlaps the
 * fewest already-placed labels and pins and stays inside the bounds, preferring the earlier candidates on ties.
 * Positions are rounded to whole pixels so labels render crisp.
 */

export type LabelPlace = 'top' | 'bottom' | 'right' | 'left' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export interface LabelItem {
  id: string
  /** Pin position in px. */
  x: number
  y: number
  /** Label size in px. */
  w: number
  h: number
  /** Clearance between the pin centre and the label (px). */
  gap: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed {
  id: string
  place: LabelPlace
  /** Label box in px (top-left + size). */
  rect: Rect
  /** Offset of the label's top-left from the pin, for a CSS translate. */
  dx: number
  dy: number
}

const ORDER: LabelPlace[] = ['top', 'right', 'left', 'bottom', 'top-right', 'top-left', 'bottom-right', 'bottom-left']

function rectFor(it: LabelItem, place: LabelPlace): Rect {
  const { x, y, w, h, gap } = it
  const d = gap * 0.72
  switch (place) {
    case 'top':
      return { x: x - w / 2, y: y - gap - h, w, h }
    case 'bottom':
      return { x: x - w / 2, y: y + gap, w, h }
    case 'right':
      return { x: x + gap, y: y - h / 2, w, h }
    case 'left':
      return { x: x - gap - w, y: y - h / 2, w, h }
    case 'top-right':
      return { x: x + d, y: y - d - h, w, h }
    case 'top-left':
      return { x: x - d - w, y: y - d - h, w, h }
    case 'bottom-right':
      return { x: x + d, y: y + d, w, h }
    case 'bottom-left':
      return { x: x - d - w, y: y + d, w, h }
  }
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function outside(r: Rect, b: Rect): number {
  const inside = overlapArea(r, b)
  return r.w * r.h - inside
}

/**
 * Place labels in the given order (most important first). `pinRadius` reserves a square around every pin so no label
 * covers another pin's dot. `margin` keeps labels apart from each other.
 */
export function placeLabels(items: readonly LabelItem[], bounds: Rect, opts: { pinRadius?: number; margin?: number } = {}): Placed[] {
  const pr = opts.pinRadius ?? 9
  const m = opts.margin ?? 4
  const pins: Rect[] = items.map((it) => ({ x: it.x - pr, y: it.y - pr, w: pr * 2, h: pr * 2 }))
  const placed: Placed[] = []
  for (const it of items) {
    let best = { place: ORDER[0], rect: rectFor(it, ORDER[0]), score: Infinity }
    ORDER.forEach((place, i) => {
      const rect = rectFor(it, place)
      const grown = { x: rect.x - m, y: rect.y - m, w: rect.w + 2 * m, h: rect.h + 2 * m }
      let score = i * 0.5
      for (const p of placed) score += overlapArea(grown, p.rect) * 10
      pins.forEach((p, k) => {
        if (items[k].id !== it.id) score += overlapArea(rect, p) * 10
      })
      score += outside(rect, bounds) * 4
      if (score < best.score) best = { place, rect, score }
    })
    const b = best
    const rect = { x: Math.round(b.rect.x), y: Math.round(b.rect.y), w: b.rect.w, h: b.rect.h }
    placed.push({ id: it.id, place: b.place, rect, dx: Math.round(rect.x - it.x), dy: Math.round(rect.y - it.y) })
  }
  return placed
}
