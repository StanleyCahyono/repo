'use client'
/**
 * Forecast toolbar: which resorts are compared (and which one is in focus for the hourly timeline and history),
 * base vs upper-mountain point, and a date jump (past → history day, within the forecast → outlook day, further →
 * planning information). Everything writes to the URL through the forecast nav.
 */
import { useId, useRef, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { CloudOff, X } from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import type { PickerResort, ResortInfo } from '@/lib/data/forecast-screen'
import { chartUnits } from '@/components/charts/units'
import type { UnitPrefs } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useForecastNav } from './nav'
import { POINT_LABEL, pointElevation, type PointKey } from './model'
import { MAX_COMPARE, validDate } from './params'
import { ResortPicker } from './resort-picker'

export function ForecastToolbar({
  catalog,
  selected,
  resorts,
  focus,
  hasForecast,
  point,
  units,
  today,
}: {
  catalog: PickerResort[]
  selected: string[]
  resorts: Record<string, ResortInfo>
  focus: string | null
  /** Resort ids with a stored forecast. */
  hasForecast: ReadonlySet<string>
  point: PointKey
  units: UnitPrefs
  /** Reference today for the date input (the focus resort's local today). */
  today: string
}) {
  const { navigate, params } = useForecastNav()
  const q = chartUnits(units)
  const groupId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusIndex = Math.max(0, selected.indexOf(focus ?? ''))

  const setFocus = (id: string) => {
    if (id !== focus) navigate({ focus: id })
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = selected.length
    const map: Record<string, number> = {
      ArrowRight: (i + 1) % n,
      ArrowDown: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      ArrowUp: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    }
    if (!(e.key in map)) return
    e.preventDefault()
    const next = map[e.key]
    refs.current[next]?.focus()
    setFocus(selected[next])
  }

  const focusInfo = focus ? resorts[focus] : null
  const elevHint = (p: PointKey) => {
    const m = pointElevation(focusInfo, p)
    return m !== null ? `${POINT_LABEL[p]} · ${q.elevation.format(m)}` : POINT_LABEL[p]
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-divider bg-surface px-4 py-3.5 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-6 md:gap-y-3 md:px-5">
      {/* Resorts in comparison + focus */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <p id={groupId} className="eyebrow">
            Resorts
          </p>
          <p className="text-[12.5px] text-ink-3 tnum">
            {selected.length} of {MAX_COMPARE}
            <span className="hidden sm:inline"> · pick one for its hourly and history</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.length ? (
            <div role="radiogroup" aria-labelledby={groupId} aria-describedby={`${groupId}-hint`} className="flex flex-wrap gap-2">
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
                      'relative inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 md:h-9 md:text-[13.5px]',
                      on ? 'border-teal text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink',
                    )}
                  >
                    {on ? (
                      <motion.span layoutId="forecast-focus-chip" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-glacier" />
                    ) : null}
                    <span className="relative">{info?.shortName ?? info?.name ?? id}</span>
                    {noData ? (
                      <span className="relative inline-flex items-center text-ink-3" title="No forecast stored">
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
        </div>
        <p id={`${groupId}-hint`} className="sr-only">
          The resort you pick is shown in the hourly timeline and the history calendar; the daily outlook compares all of them.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5">
        <div className="flex flex-col gap-2">
          <p className="eyebrow hidden md:block" aria-hidden>
            Weather point
          </p>
          <Segmented<PointKey>
            label="Weather point"
            value={point}
            onChange={(v) => navigate({ pt: v === 'base' ? null : v })}
            options={[
              { value: 'base', label: POINT_LABEL.base, hint: elevHint('base') },
              { value: 'summit', label: POINT_LABEL.summit, hint: elevHint('summit') },
            ]}
            className="w-full sm:w-auto [&_[role=radio]]:h-11 [&_[role=radio]]:flex-1 sm:[&_[role=radio]]:flex-none md:[&_[role=radio]]:h-9 [&_[role=radiogroup]]:flex sm:[&_[role=radiogroup]]:inline-flex"
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
    <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
      <label htmlFor={id} className="eyebrow shrink-0">
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
          className="h-11 w-full min-w-0 rounded-[10px] border border-divider-strong bg-surface px-3 text-[14px] text-ink tnum transition-colors duration-150 hover:border-ink-3 focus:border-teal focus:outline-none sm:w-[172px] md:h-9"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-[10px] px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink md:h-9"
          >
            <X aria-hidden className="size-4" />
            Today
          </button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="sr-only">
        A past date opens its history; a date within the forecast shows that day; a later date shows planning information. Today is {today}.
      </p>
    </div>
  )
}
