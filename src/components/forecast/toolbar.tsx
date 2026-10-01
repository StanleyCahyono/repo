'use client'
/**
 * Forecast controls (Glass HUD).
 *
 * - `ResortPills`: the compared resorts as a glass pill group; the dark chip glides to the resort in focus (its
 *   16-day strip, 48 hours and calendar). A cloud-off mark flags resorts without a stored forecast. "Change resorts"
 *   opens the picker (≤ 4).
 * - `ForecastControls`: base vs upper-mountain point and a date jump (past → history day, within the forecast →
 *   outlook day, further → planning information).
 * Everything writes to the URL through the forecast nav.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { CloudOff, X } from 'lucide-react'
import type { PickerResort, ResortInfo } from '@/lib/data/forecast-screen'
import { chartUnits } from '@/components/charts/units'
import { formatLocalDate } from '@/lib/domain/time'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { PillToggle } from './hud'
import { useForecastNav } from './nav'
import { POINT_LABEL, pointElevation, type PointKey } from './model'
import { validDate } from './params'
import { ResortPicker } from './resort-picker'

export function ResortPills({
  catalog,
  selected,
  resorts,
  focus,
  hasForecast,
}: {
  catalog: PickerResort[]
  selected: string[]
  resorts: Record<string, ResortInfo>
  focus: string | null
  /** Resort ids with a stored forecast. */
  hasForecast: ReadonlySet<string>
}) {
  const { navigate } = useForecastNav()
  const groupId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusIndex = Math.max(0, selected.indexOf(focus ?? ''))

  const setFocus = (id: string) => {
    if (id !== focus) navigate({ focus: id })
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = selected.length
    const map: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    const next = map[e.key]
    refs.current[next]?.focus()
    setFocus(selected[next])
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {selected.length ? (
        <div role="radiogroup" aria-label="Resort in focus" aria-describedby={`${groupId}-hint`} className="glass flex max-w-full flex-wrap gap-0.5 rounded-[26px] p-[5px]">
          {selected.map((id, i) => {
            const on = id === focus
            const info = resorts[id]
            const noData = !hasForecast.has(id)
            return (
              <button
                key={id}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === focusIndex ? 0 : -1}
                title={info?.name}
                onClick={() => setFocus(id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  'relative inline-flex h-10 items-center gap-1.5 rounded-full px-[15px] text-[13.5px] font-medium whitespace-nowrap outline-offset-2 transition-colors duration-150',
                  on ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink',
                )}
              >
                {on ? <motion.span layoutId="forecast-focus-chip" transition={t.spring} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
                <span className="relative">{info?.shortName ?? info?.name ?? id}</span>
                {noData ? (
                  <span className={cn('relative inline-flex items-center', on ? 'text-on-ink-chip-2' : 'text-ink-3')} title="No forecast stored">
                    <CloudOff aria-hidden className="size-3.5" />
                    <span className="sr-only">(no forecast stored)</span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
      <ResortPicker
        catalog={catalog}
        selected={selected}
        onApply={(ids) => navigate({ r: ids.join(','), focus: ids.includes(focus ?? '') ? focus : (ids[0] ?? null) })}
      />
      <p id={`${groupId}-hint`} className="sr-only">
        The resort you pick is shown in the 16-day strip, the next 48 hours and the calendar; the daily outlook compares all of them.
      </p>
    </div>
  )
}

export function ForecastControls({
  resorts,
  focus,
  point,
  units,
  today,
  children,
}: {
  resorts: Record<string, ResortInfo>
  focus: string | null
  point: PointKey
  units: UnitPrefs
  /** Reference today for the date input (the focus resort's local today). */
  today: string
  /** Extra content at the start of the bar. */
  children?: ReactNode
}) {
  const { navigate, params } = useForecastNav()
  const q = chartUnits(units)
  const focusInfo = focus ? resorts[focus] : null
  const elev = (p: PointKey) => {
    const m = pointElevation(focusInfo, p)
    return m !== null ? q.elevation.format(m) : null
  }

  return (
    <div className="glass flex flex-col gap-3 rounded-[24px] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-5 md:px-5">
      {children ? <div className="min-w-0 flex-1 basis-[260px]">{children}</div> : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="hud text-ink-2 max-sm:hidden" aria-hidden>
            Point
          </span>
          <PillToggle<PointKey>
            label="Weather point"
            value={point}
            onChange={(v) => navigate({ pt: v === 'base' ? null : v })}
            options={(['base', 'summit'] as const).map((p) => ({
              value: p,
              label: (
                <>
                  {POINT_LABEL[p]}
                  {elev(p) ? <span className="ml-1.5 font-mono text-[12px] text-ink-3 max-md:hidden">{elev(p)}</span> : null}
                </>
              ),
              aria: elev(p) ? `${POINT_LABEL[p]}, ${elev(p)}` : POINT_LABEL[p],
            }))}
          />
        </div>
        <DateJump value={params.date} today={today} onChange={(d) => navigate({ date: d, month: null })} />
      </div>
    </div>
  )
}

function DateJump({ value, today, onChange }: { value: string | null; today: string; onChange: (d: string | null) => void }) {
  const id = useId()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <label htmlFor={id} className="hud shrink-0 text-ink-2">
        Go to date
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          id={id}
          type="date"
          value={value ?? ''}
          onChange={(e) => {
            const d = validDate(e.target.value)
            if (d) onChange(d)
          }}
          aria-describedby={`${id}-hint`}
          className="h-10 w-full min-w-0 rounded-full border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-surface/80 px-3.5 text-[13.5px] text-ink tnum transition-colors duration-150 hover:border-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 sm:w-[168px]"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink"
          >
            <X aria-hidden className="size-4" />
            Today
          </button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="sr-only">
        A past date opens its history; a date within the forecast shows that day; a later date shows planning information. Today is {formatLocalDate(today, 'cccc d LLLL yyyy')}.
      </p>
    </div>
  )
}
