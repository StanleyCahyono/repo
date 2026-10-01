'use client'
/**
 * Chart container: title, evidence tag, legend, actions and the "Show as table" toggle that swaps the chart for its
 * accessible data-table twin. Every chart in Piste should sit in a ChartFrame (or offer the same toggle).
 *
 * The view can be uncontrolled (`defaultView`) or controlled (`view` + `onViewChange`) when a page wants one switch
 * for several charts. The chart stays mounted while the table is shown, so scrubber state survives the toggle.
 */
import { useId, useState, type ReactNode } from 'react'
import { ChartSpline, Table2 } from 'lucide-react'
import { KindTag } from '@/components/ui/provenance'
import type { DataKind } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { ChartTable, type ChartTableProps } from './chart-table'
import { Legend, type LegendItem } from './legend'

export type ChartView = 'chart' | 'table'

export interface ChartFrameProps {
  /** Visible title. Use `titleAs` to fit the page's heading order. */
  title: ReactNode
  titleAs?: 'h2' | 'h3' | 'h4' | 'p'
  /** Hide the title visually (still labels the figure), e.g. when the section heading already says it. */
  hideTitle?: boolean
  subtitle?: ReactNode
  /** Evidence kind of everything plotted (Model, Reported, Piste estimate…). */
  kind?: DataKind
  /** Also label the data as demo data (keeps the evidence kind visible in demo mode). */
  demo?: boolean
  legend?: LegendItem[]
  /** Extra controls rendered next to the table toggle (source drawer, filters). */
  actions?: ReactNode
  /** The table twin. Required: every chart has one. */
  table: ChartTableProps
  view?: ChartView
  defaultView?: ChartView
  onViewChange?: (v: ChartView) => void
  /** Content under the chart/table (notes, attribution). */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

export function ChartFrame({
  title,
  titleAs: T = 'h3',
  hideTitle,
  subtitle,
  kind,
  demo,
  legend,
  actions,
  table,
  view,
  defaultView = 'chart',
  onViewChange,
  footer,
  className,
  children,
}: ChartFrameProps) {
  const [inner, setInner] = useState<ChartView>(defaultView)
  const current = view ?? inner
  const set = (v: ChartView) => {
    if (view === undefined) setInner(v)
    onViewChange?.(v)
  }
  const titleId = useId()
  return (
    <figure aria-labelledby={titleId} className={cn('m-0 flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className={cn('min-w-0', hideTitle && 'sr-only')}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <T id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </T>
            {kind ? <KindTag kind={kind} /> : null}
            {demo && kind !== 'demo' ? <KindTag kind="demo" /> : null}
          </div>
          {subtitle ? <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {actions}
          <button
            type="button"
            aria-pressed={current === 'table'}
            onClick={() => set(current === 'table' ? 'chart' : 'table')}
            className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink md:h-8"
          >
            {current === 'table' ? <ChartSpline aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
            {current === 'table' ? 'Show as chart' : 'Show as table'}
          </button>
        </div>
      </div>
      {legend?.length && current === 'chart' ? <Legend items={legend} /> : null}
      <div hidden={current === 'table'}>{children}</div>
      {current === 'table' ? <ChartTable {...table} /> : null}
      {footer ? <figcaption className="text-[12.5px] text-ink-3">{footer}</figcaption> : null}
    </figure>
  )
}
