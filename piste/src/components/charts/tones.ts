/**
 * Mark colours for charts — design tokens only (Tailwind utilities generated from src/app/globals.css), so light and
 * dark themes swap automatically. Class strings are spelled out in full so Tailwind can see them.
 *
 * Roles: `teal` is the hero series (snowfall); `ink`/`ink-2`/`ink-3` are neutral context series; `copper` is reserved
 * for Piste-derived values (estimates, scores). Status colours (positive/caution/critical/info) are deliberately
 * absent: they mean states, never series.
 */
import type { DataKind } from '@/lib/domain/types'

export type Tone = 'teal' | 'ink' | 'ink-2' | 'ink-3' | 'copper'

export interface ToneClasses {
  stroke: string
  fill: string
  /** Soft wash for areas and bands (~10–14%). */
  wash: string
  /** Emphasised fill for the active/selected mark. */
  active: string
  /** Swatch background for HTML legends. */
  bg: string
  /** Border colour for outlined HTML swatches. */
  border: string
}

export const TONES: Record<Tone, ToneClasses> = {
  teal: { stroke: 'stroke-teal', fill: 'fill-teal', wash: 'fill-teal/12', active: 'fill-teal-strong', bg: 'bg-teal', border: 'border-teal' },
  ink: { stroke: 'stroke-ink', fill: 'fill-ink', wash: 'fill-ink/10', active: 'fill-ink', bg: 'bg-ink', border: 'border-ink' },
  'ink-2': { stroke: 'stroke-ink-2', fill: 'fill-ink-2', wash: 'fill-ink-2/14', active: 'fill-ink', bg: 'bg-ink-2', border: 'border-ink-2' },
  'ink-3': { stroke: 'stroke-ink-3', fill: 'fill-ink-3', wash: 'fill-ink-3/14', active: 'fill-ink-2', bg: 'bg-ink-3', border: 'border-ink-3' },
  copper: { stroke: 'stroke-copper', fill: 'fill-copper', wash: 'fill-copper/12', active: 'fill-copper', bg: 'bg-copper', border: 'border-copper' },
}

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export const DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1.5 3.5',
}

/**
 * Default line style per evidence kind, so model output, reports and Piste-derived values never look alike:
 * model/observed = solid, reported/manual = points only (no invented line between reports), Piste-derived = dashed.
 */
export function styleForKind(kind: DataKind | undefined): { style: LineStyle; pointsOnly: boolean } {
  switch (kind) {
    case 'official':
    case 'manual':
    case 'historical':
      return { style: 'solid', pointsOnly: true }
    case 'derived':
      return { style: 'dashed', pointsOnly: false }
    default:
      return { style: 'solid', pointsOnly: false }
  }
}
