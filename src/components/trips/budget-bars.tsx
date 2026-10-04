'use client'
/**
 * Where the money goes: one row per category, a single-hue bar (the low end solid, the rest of an estimate range as a
 * lighter step of the same hue), the amount at the tip in text tokens and the share of the known total. It is a real
 * table (the bars are decoration beside the numbers), so nothing is colour-only or hover-only. Bars reveal once.
 */
import { motion } from 'motion/react'
import { formatMoney, formatMoneyRange, money } from '@/lib/domain/money'
import { t } from '@/lib/ui/motion'
import { cn } from '@/lib/ui/cn'

export interface BarRow {
  key: string
  label: string
  lines: number
  min: number
  max: number
}

/** The two-step bar; it grows once when it scrolls into view (the track is observed — a zero-width bar has no area). */
function Bar({ min, max, top, k, className }: { min: number; max: number; top: number; k: number; className?: string }) {
  const grow = { hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { ...t.bars, delay: 0.05 * k } } }
  return (
    <motion.div aria-hidden initial="hidden" whileInView="show" viewport={{ once: true, margin: '0px 0px -40px 0px' }} className={cn('relative h-2.5 overflow-hidden rounded-r-[4px] bg-surface-3', className)}>
      <motion.div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-teal/30" style={{ width: `${(max / top) * 100}%`, originX: 0 }} variants={grow} />
      <motion.div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-teal" style={{ width: `${(min / top) * 100}%`, originX: 0 }} variants={grow} />
    </motion.div>
  )
}

export function BudgetBars({ rows, currency, caption }: { rows: BarRow[]; currency: string; caption: string }) {
  const top = Math.max(1, ...rows.map((r) => r.max))
  const knownMin = rows.reduce((s, r) => s + r.min, 0)
  const knownMax = rows.reduce((s, r) => s + r.max, 0)
  const pct = (r: BarRow) => (knownMin + knownMax > 0 ? Math.round(((r.min + r.max) / 2 / ((knownMin + knownMax) / 2)) * 100) : 0)
  return (
    <>
    {/* Narrow screens: label and amount on one line, the bar full width beneath (same data as the table). */}
    <ul aria-label={caption} className="flex flex-col gap-3 sm:hidden">
      {rows.map((r, k) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="font-medium text-ink">{r.label}</span>
            <span className="text-ink tnum">
              <span className="font-semibold">{formatMoneyRange(money(r.min, currency), money(r.max, currency))}</span>
              <span className="ml-2 text-[12.5px] text-ink-3">{pct(r)}%<span className="sr-only"> of the known total</span></span>
            </span>
          </div>
          <Bar min={r.min} max={r.max} top={top} k={k} className="mt-1.5" />
        </li>
      ))}
      <li className="flex items-baseline justify-between border-t border-divider pt-2 text-[13px]">
        <span className="font-medium text-ink-2">Known total</span>
        <span className="font-semibold text-ink tnum">{formatMoneyRange(money(knownMin, currency), money(knownMax, currency))}</span>
      </li>
    </ul>
    <table className="hidden w-full border-separate border-spacing-y-2 text-[13.5px] sm:table">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Amount</th>
          <th scope="col">Share of the known total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => {
          const range = formatMoneyRange(money(r.min, currency), money(r.max, currency))
          const mid = (r.min + r.max) / 2
          const share = knownMin + knownMax > 0 ? Math.round((mid / ((knownMin + knownMax) / 2)) * 100) : 0
          return (
            <tr key={r.key} title={`${r.label}: ${range} (${r.lines} item${r.lines === 1 ? '' : 's'})`}>
              <th scope="row" className="w-[104px] pr-3 text-left align-middle font-medium text-ink sm:w-[124px]">
                {r.label}
              </th>
              <td className="align-middle">
                <div className="flex items-center gap-3">
                  <Bar min={r.min} max={r.max} top={top} k={k} className="min-w-[40px] flex-1" />
                  <span className="w-[112px] shrink-0 text-right font-semibold text-ink tnum sm:w-[128px]">{range}</span>
                </div>
              </td>
              <td className="w-[48px] pl-2 text-right align-middle text-[12.5px] text-ink-3 tnum">{share}%</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="pt-1 pr-3 text-left text-[12.5px] font-medium text-ink-2">
            Known total
          </th>
          <td className="pt-1 text-right text-[13.5px] font-semibold text-ink tnum">
            <span className="inline-block w-[112px] sm:w-[128px]">{formatMoneyRange(money(knownMin, currency), money(knownMax, currency)) ?? formatMoney(money(0, currency))}</span>
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
    </>
  )
}
