/**
 * The accessible data-table twin of a chart: every value a chart draws is readable here, including honest
 * "Not provided" cells for variables the source did not supply (never blank, never 0).
 */
import type { ReactNode } from 'react'
import { Missing } from '@/components/ui/provenance'
import { cn } from '@/lib/ui/cn'

export interface ChartTableColumn {
  key: string
  label: ReactNode
  /** Unit shown under the header ('in', '°F'). */
  unit?: string
  align?: 'left' | 'right'
}

export interface ChartTableRow {
  key: string
  /** Row header (usually the time or day). */
  header: ReactNode
  /** Cell values by column key. null/undefined renders the missing label. */
  cells: Record<string, ReactNode | null | undefined>
  /** Group/tint the row (e.g. a less certain trend day). */
  tone?: 'default' | 'muted' | 'selected'
}

export interface ChartTableProps {
  caption: ReactNode
  /** Header of the row-header column ('Time', 'Day'). */
  rowHeader: ReactNode
  columns: ChartTableColumn[]
  rows: ChartTableRow[]
  /** Label for missing cells. Default "Not provided". */
  missingLabel?: string
  /** Scroll the body after this height (px); the header stays visible. */
  maxHeight?: number
  className?: string
}

export function ChartTable({ caption, rowHeader, columns, rows, missingLabel = 'Not provided', maxHeight, className }: ChartTableProps) {
  return (
    <div
      className={cn('overflow-auto rounded-[10px] border border-divider scrollbar-thin', className)}
      style={maxHeight ? { maxHeight } : undefined}
      tabIndex={0}
      role="region"
      aria-label={typeof caption === 'string' ? caption : 'Data table'}
    >
      <table className="w-full border-collapse text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-[1] bg-surface-2">
          <tr className="border-b border-divider">
            <th scope="col" className="px-3 py-2 text-left text-[12.5px] font-semibold whitespace-nowrap text-ink-2">
              {rowHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-ink-2', c.align === 'left' ? 'text-left' : 'text-right')}
              >
                {c.label}
                {c.unit ? <span className="ml-1 font-normal text-ink-3">({c.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={cn(
                'border-b border-divider last:border-b-0',
                r.tone === 'muted' && 'bg-surface-2 text-ink-2',
                r.tone === 'selected' && 'bg-glacier/50',
              )}
            >
              <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap text-ink tnum">
                {r.header}
              </th>
              {columns.map((c) => {
                const v = r.cells[c.key]
                return (
                  <td key={c.key} className={cn('px-3 py-1.5 whitespace-nowrap tnum', c.align === 'left' ? 'text-left' : 'text-right')}>
                    {v === null || v === undefined ? <Missing kind="unavailable" label={missingLabel} className="text-[12.5px]" /> : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
