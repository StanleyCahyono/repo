'use client'
/**
 * Daily bars on a categorical day axis — e.g. modeled snowfall per resort-local day. HTML/CSS, so it renders on the
 * server at any width with no measuring.
 *
 * - Less certain trend days (`trend`) sit on a hatched band; partial days show "≥" (the total covers part of the day).
 * - Unknown values render a hatched stub and "–", never an empty (zero-looking) slot.
 * - With `onSelect` the days become a radio group (roving focus, ←/→/Home/End) and the selection highlight glides
 *   between days with a shared layoutId (t.select). Several DailyBars can share a `layoutGroup` + `selected` so one
 *   selection moves across stacked charts. Pass `max` to put several charts on one scale.
 */
import { useId, useRef, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t as motionT } from '@/lib/ui/motion'
import { TONES, type Tone } from './tones'

export interface DailyBarDatum {
  /** Stable key, usually the local date. */
  key: string
  /** Short day label ('Sat'). */
  label: string
  /** Second line ('16'). */
  sublabel?: string
  /** Value in display units; null = not provided. */
  value: number | null
  /** Formatted value for the label ('4.2″'). */
  display?: string | null
  /** Less certain trend day (hatched). */
  trend?: boolean
  /** The value covers only part of the day (a lower bound). */
  partial?: boolean
  /** Spoken description override for this day. */
  description?: string
}

export interface DailyBarsProps {
  days: DailyBarDatum[]
  /** Accessible name of the group ('Modeled snowfall by day, Alta'). */
  label: string
  /** Shared axis top (display units). Default: the largest value (at least `floorMax`). */
  max?: number
  floorMax?: number
  /** Bar area height in px. */
  height?: number
  tone?: Tone
  selected?: string | null
  onSelect?: (key: string) => void
  /** Which values to print: all, only the largest, or none (table/tooltip carry the rest). */
  showValues?: 'all' | 'max' | 'none'
  /** Namespace for the shared selection glide. */
  layoutGroup?: string
  /** Hide the day labels (when stacked under another chart that shows them). */
  hideDayLabels?: boolean
  className?: string
}

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const HATCH = 'repeating-linear-gradient(135deg, var(--divider) 0 1px, transparent 1px 6px)'

export function DailyBars({
  days,
  label,
  max,
  floorMax = 0,
  height = 56,
  tone = 'teal',
  selected = null,
  onSelect,
  showValues = 'all',
  layoutGroup,
  hideDayLabels,
  className,
}: DailyBarsProps) {
  const auto = Math.max(floorMax, ...days.map((d) => (known(d.value) ? d.value : 0)))
  const top = max ?? auto
  const maxKey = days.reduce<{ key: string | null; v: number }>((acc, d) => (known(d.value) && d.value > acc.v ? { key: d.key, v: d.value } : acc), {
    key: null,
    v: 0,
  }).key
  const gid = useId()
  const group = layoutGroup ?? gid
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const interactive = !!onSelect
  const selIndex = days.findIndex((d) => d.key === selected)

  const onKey = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: days.length - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    const next = Math.min(days.length - 1, Math.max(0, map[e.key]))
    onSelect?.(days[next].key)
    refs.current[next]?.focus()
  }

  return (
    <div role={interactive ? 'radiogroup' : 'list'} aria-label={label} className={cn('flex w-full items-stretch', className)}>
      {days.map((d, i) => {
        const v = d.value
        const pct = known(v) && top > 0 ? Math.max(v > 0 ? 3 : 0, (v / top) * 100) : 0
        const isSel = d.key === selected
        const valueText = known(v) ? `${d.partial ? '≥ ' : ''}${d.display ?? v}` : '–'
        const printed = showValues === 'all' || (showValues === 'max' && d.key === maxKey)
        const spoken =
          d.description ??
          `${d.label} ${d.sublabel ?? ''}: ${known(v) ? `${d.partial ? 'at least ' : ''}${d.display ?? v}` : 'not provided'}${d.trend ? ', less certain trend' : ''}`
        const body = (
          <>
            {isSel ? (
              <motion.span layoutId={`daily-sel-${group}`} transition={motionT.select} aria-hidden className="absolute inset-0 rounded-[8px] bg-glacier" />
            ) : null}
            <span
              className={cn(
                'relative block h-4 text-[12px] leading-4 tnum',
                known(v) && v > 0 ? 'font-semibold text-ink' : 'text-ink-3',
                !printed && 'invisible',
              )}
            >
              {valueText}
            </span>
            <span
              className="relative mx-auto mt-1 flex w-full items-end justify-center rounded-[4px]"
              style={{ height, backgroundImage: d.trend ? HATCH : undefined }}
            >
              {known(v) ? (
                v > 0 ? (
                  <motion.span
                    className={cn('block w-[min(70%,24px)] rounded-t-[4px]', TONES[tone].bg)}
                    style={{ height: `${pct}%`, transformOrigin: 'bottom' }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={motionT.bars}
                  />
                ) : (
                  <span className="block h-px w-[min(70%,24px)] bg-divider-strong" />
                )
              ) : (
                <span className="block h-2 w-[min(70%,24px)] rounded-t-[2px] border border-b-0 border-divider-strong" style={{ backgroundImage: HATCH }} />
              )}
            </span>
            {hideDayLabels ? null : (
              <span className="relative mt-1.5 block text-center leading-tight">
                <span className={cn('block text-[12px] font-medium', isSel ? 'text-teal' : 'text-ink-2')}>{d.label}</span>
                {d.sublabel ? <span className="block text-[12px] text-ink-3 tnum">{d.sublabel}</span> : null}
              </span>
            )}
          </>
        )
        return interactive ? (
          <button
            key={d.key}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={isSel}
            aria-label={spoken}
            tabIndex={isSel || (selIndex === -1 && i === 0) ? 0 : -1}
            onClick={() => onSelect?.(d.key)}
            onKeyDown={(e) => onKey(e, i)}
            className="relative min-w-0 flex-1 rounded-[8px] px-0.5 pt-1 pb-1.5 text-center transition-colors duration-150 hover:bg-surface-3/70"
          >
            {body}
          </button>
        ) : (
          <div key={d.key} role="listitem" aria-label={spoken} className="relative min-w-0 flex-1 px-0.5 pt-1 pb-1.5 text-center">
            {body}
          </div>
        )
      })}
    </div>
  )
}
