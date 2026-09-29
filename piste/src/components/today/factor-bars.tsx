'use client'
/**
 * "How the ranking adds up": one row per factor — its weight, its 0–100 value, and the points it adds
 * (weight × value). A real table (the bars are decoration beside the numbers), so it reads correctly without
 * sight or colour. Unknown factors are hatched and say what they were counted at. Bars reveal once (380 ms).
 */
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import type { FactorView } from './rank-model'

const HATCH = 'repeating-linear-gradient(135deg, var(--divider-strong) 0 1.5px, transparent 1.5px 6px)'

export function FactorBars({
  factors,
  total,
  caption,
  compact = false,
  className,
}: {
  factors: FactorView[]
  total: number
  caption: string
  compact?: boolean
  className?: string
}) {
  const rows = [...factors].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
  return (
    <table className={cn('w-full border-collapse text-left', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead className={compact ? 'sr-only' : undefined}>
        <tr className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          <th scope="col" className="pb-1.5 font-semibold">
            Factor
          </th>
          <th scope="col" className="pb-1.5 text-right font-semibold">
            Weight
          </th>
          <th scope="col" className="pb-1.5 pl-3 font-semibold">
            <span className="sr-only">Value (0–100)</span>
            <span aria-hidden>Value</span>
          </th>
          <th scope="col" className="pb-1.5 text-right font-semibold">
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const width = Math.max(2, Math.min(100, f.used))
          return (
            <tr key={f.key} className="align-top">
              <th scope="row" className="w-[44%] py-1 pr-3 text-left text-[13.5px] font-medium text-ink">
                <span className="block whitespace-nowrap">{f.label}</span>
                {f.note ? <span className="block text-[12px] leading-snug font-normal text-ink-3">{f.note}</span> : null}
              </th>
              <td className="tnum w-10 py-1 pt-[5px] text-right text-[12.5px] text-ink-3">{Math.round(f.weight * 100)}%</td>
              <td className="py-1 pt-[5px] pl-3">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="relative h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <motion.span
                      className={cn('absolute inset-y-0 left-0 rounded-full', f.known ? 'bg-teal' : 'border border-dashed border-divider-strong')}
                      style={{
                        width: `${width}%`,
                        originX: 0,
                        backgroundImage: f.known ? undefined : HATCH,
                      }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={t.bars}
                    />
                  </span>
                  <span className={cn('tnum w-[4.5rem] shrink-0 text-[12.5px]', f.known ? 'font-semibold text-ink' : 'text-ink-3 italic')}>
                    {f.known ? f.value : `unknown→${f.used}`}
                  </span>
                </span>
              </td>
              <td className="tnum w-12 py-1 pt-[5px] pl-2 text-right text-[12.5px] text-ink-2">{f.points.toFixed(1)}</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-divider">
          <th scope="row" colSpan={3} className="pt-1.5 text-right text-[12.5px] font-medium text-ink-2">
            Ranking total
          </th>
          <td className="tnum pt-1.5 text-right text-[13.5px] font-semibold text-ink">{total.toFixed(1)}</td>
        </tr>
      </tfoot>
    </table>
  )
}
