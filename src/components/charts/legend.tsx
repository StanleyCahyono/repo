/**
 * Chart legend. Swatches mirror the mark (line, dashed line, bar, band, point, hatch) so identity never rests on
 * colour alone; legend text always wears text tokens, never the series colour. An optional evidence tag says what
 * kind of data each series is (Model / Reported / Piste estimate …).
 */
import type { ReactNode } from 'react'
import { KindTag } from '@/components/ui/provenance'
import type { DataKind } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { TONES, type Tone } from './tones'

export type SwatchShape = 'line' | 'dashed' | 'dotted' | 'bar' | 'band' | 'point' | 'hatch' | 'rule'

export interface LegendItem {
  label: ReactNode
  tone: Tone
  shape: SwatchShape
  /** Evidence kind shown as a small tag after the label. */
  kind?: DataKind
  /** Short extra note, e.g. "hour to the stamp". */
  note?: ReactNode
}

export function Swatch({ tone, shape, className }: { tone: Tone; shape: SwatchShape; className?: string }) {
  const c = TONES[tone]
  if (shape === 'bar') return <span aria-hidden className={cn('inline-block h-3 w-2.5 rounded-t-[2px]', c.bg, className)} />
  if (shape === 'band') return <span aria-hidden className={cn('inline-block h-2.5 w-4 rounded-[2px] opacity-30', c.bg, className)} />
  if (shape === 'point') return <span aria-hidden className={cn('inline-block size-2.5 rounded-full ring-2 ring-surface', c.bg, className)} />
  if (shape === 'hatch')
    return (
      <span
        aria-hidden
        className={cn('inline-block h-3 w-4 rounded-[2px] border border-divider-strong', className)}
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, var(--divider-strong) 0 1px, transparent 1px 5px)' }}
      />
    )
  if (shape === 'rule') return <span aria-hidden className={cn('inline-block h-3 w-0 border-l border-divider-strong', className)} />
  const dash = shape === 'dashed' ? 'border-dashed' : shape === 'dotted' ? 'border-dotted' : 'border-solid'
  return <span aria-hidden className={cn('inline-block w-4 border-t-2', dash, c.border, className)} />
}

export function Legend({ items, className, label = 'Legend' }: { items: LegendItem[]; className?: string; label?: string }) {
  if (!items.length) return null
  return (
    <ul aria-label={label} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2', className)}>
      {items.map((it, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          <Swatch tone={it.tone} shape={it.shape} />
          <span>{it.label}</span>
          {it.note ? <span className="text-ink-3">{it.note}</span> : null}
          {it.kind ? <KindTag kind={it.kind} compact className="ml-0.5" /> : null}
        </li>
      ))}
    </ul>
  )
}
