'use client'
/**
 * Ready-made TimePanels for the two weather traces every screen needs. Both render inside a <TimeChart>.
 *
 * - SnowfallBars: accumulated snowfall per interval (hourly bars in the provider's interval semantics — build them
 *   with `hourInterval`). Snowfall is its own quantity: never rain, never water equivalent, never snow depth.
 * - WindBand: sustained wind as the line with a soft band up to the gusts, on one speed axis.
 */
import type { ReactNode } from 'react'
import type { DataKind } from '@/lib/domain/types'
import type { LegendItem } from './legend'
import { TimePanel, type TimeBar, type TimePoint } from './time-chart'
import type { Tone } from './tones'

const NOT_PROVIDED: LegendItem = { label: 'Not provided', tone: 'ink-3', shape: 'hatch' }

export interface SnowfallBarsProps {
  bars: TimeBar[]
  /** Display unit label ('in' | 'cm'). */
  unit: string
  /** Minimum axis top in display units (e.g. 0.4 in) so a trace doesn't fill the panel. */
  floorMax?: number
  format?: (v: number) => string
  title?: ReactNode
  label?: string
  kind?: DataKind
  tone?: Tone
  height?: number
  summary?: ReactNode
  empty?: ReactNode
  /** Shown inside the plot when every known value is zero (default "None modeled"; null hides it). */
  zeroNote?: ReactNode
  className?: string
}

export function SnowfallBars({
  bars,
  unit,
  floorMax,
  format,
  title = 'Snowfall',
  label = 'Snowfall',
  kind,
  tone = 'teal',
  height = 84,
  summary,
  empty = 'Snowfall not provided by this source',
  zeroNote = 'None modeled',
  className,
}: SnowfallBarsProps) {
  const someMissing = bars.some((b) => b.v === null) && bars.some((b) => b.v !== null)
  const allZero = bars.some((b) => b.v !== null) && bars.every((b) => b.v === null || b.v === 0)
  return (
    <TimePanel
      title={title}
      unit={unit}
      height={height}
      series={[{ type: 'bars', id: 'snowfall', label, tone, kind, bars }]}
      y={{ includeZero: true, floorMax, format }}
      summary={summary}
      empty={empty}
      legend={someMissing}
      legendExtra={someMissing ? [NOT_PROVIDED] : []}
      note={allZero ? zeroNote : undefined}
      className={className}
    />
  )
}

export interface WindBandProps {
  wind: TimePoint[]
  gust: TimePoint[]
  unit: string
  floorMax?: number
  format?: (v: number) => string
  title?: ReactNode
  kind?: DataKind
  tone?: Tone
  height?: number
  summary?: ReactNode
  empty?: ReactNode
  className?: string
}

export function WindBand({
  wind,
  gust,
  unit,
  floorMax,
  format,
  title = 'Wind',
  kind,
  tone = 'ink-2',
  height = 84,
  summary,
  empty = 'Wind not provided by this source',
  className,
}: WindBandProps) {
  const hasGust = gust.some((p) => p.v !== null)
  return (
    <TimePanel
      title={title}
      unit={unit}
      height={height}
      series={
        hasGust
          ? [{ type: 'band', id: 'wind', label: 'Wind', upperLabel: 'Gusts', tone, kind, lower: wind, upper: gust }]
          : [{ type: 'line', id: 'wind', label: 'Wind', tone, kind, points: wind }]
      }
      y={{ includeZero: true, floorMax, format }}
      summary={summary}
      empty={empty}
      legend
      className={className}
    />
  )
}
