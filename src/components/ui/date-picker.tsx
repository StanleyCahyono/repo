'use client'
/**
 * Date pickers (Glass HUD) — the one calendar every date field in Piste uses.
 *
 * - `DatePicker`: a single day. `DateRangePicker`: a start and an end. `Calendar`: the same calendar inline.
 * - Values are local 'YYYY-MM-DD' strings ('' when empty), exactly like `<input type="date">`; controlled
 *   (`value` + `onChange`) or uncontrolled (`defaultValue`).
 * - Forms: `name` (or `startName` / `endName`) renders hidden inputs, so the picker works inside server-action
 *   `<form action>` and GET forms like the native input did — `required`, `form`, `disabled` and form reset included.
 *   Picking a day fires real `input` + `change` events from the hidden input, so forms that listen for changes
 *   (auto-submit, validation) still hear them.
 * - Labels: give the trigger an `id` and wrap it in `<Field htmlFor={id}>` — the trigger is labelled by that label plus
 *   the current value ("First day, Sat 16 Jan 2027"); or pass `label` / `aria-label` / `aria-labelledby`.
 * - The trigger reads "Sat 16 Jan 2027" ("Sat 16 – Mon 18 Jan 2027" for a range), never mm/dd/yyyy.
 * - ≥ 640px: a glass-strong popover (24px radius) that scales in from the trigger; ranges show two months side by side
 *   at ≥ 1024px. Phones: a bottom sheet with 48px days, swipe between months, and a sticky Done.
 * - Keyboard: arrows (day / week), PageUp / PageDown (month), Shift + PageUp / PageDown (year), Home / End (week edges),
 *   Enter / Space pick, Escape closes and returns focus to the trigger. Roving tab stop; 2px teal focus ring.
 * - "Today" comes from the `today` prop (the app clock, so demo mode works); the device clock is only a fallback.
 *
 * No Next-only APIs: this file is bundled into the single-file build too.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Dialog, Popover } from 'radix-ui'
import { CalendarDays, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import {
  addMonths,
  addMonthsToDate,
  canShowMonth,
  clampDate,
  DEFAULT_PRESETS,
  formatDate,
  formatRange,
  initialFocus,
  initialMonth,
  isDisabledDay,
  isISODate,
  legendFor,
  marksOn,
  monthOf,
  navigateDate,
  nightsLabel,
  pickRange,
  relativeDay,
  resolvePresets,
  visibleMonths,
  windowFor,
  bandRange,
  type DateConstraints,
  type DateMark,
  type DateRange,
  type PresetInput,
  type WeekStart,
} from './calendar-model'
import { DENSITY, MarkLegend, MonthGrid, MonthTitle, MonthYearChooser, NavButton, SlidingMonths, type CalendarDensity } from './date-picker-grid'

export type { DateMark, PresetInput, WeekStart } from './calendar-model'

/** A range value: 'YYYY-MM-DD' strings, '' when unset. */
export interface DateRangeValue {
  start: string
  end: string
}

type Mode = 'single' | 'range'
type Presentation = 'popover' | 'sheet' | 'inline'
export type DatePickerSize = 'field' | 'compact' | 'pill'

const norm = (v: string | null | undefined) => (isISODate(v) ? v : '')
const pad = (n: number) => String(n).padStart(2, '0')

/** Device-clock fallback, only when no `today` was passed (call in event handlers, never during render). */
function deviceToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The <label>s pointing at `el` (via htmlFor), with ids ensured so aria-labelledby can reference them. */
function fieldLabels(el: HTMLButtonElement | null, uid: string): { ids: string[]; text: string } {
  const labels = el?.labels ? Array.from(el.labels) : []
  const ids = labels.map((l, i) => {
    if (!l.id) l.id = `${uid}-label${i}`
    return l.id
  })
  const text = labels
    .map((l) => l.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s*\(optional\)$/, '')
  return { ids, text }
}

/** Set an input's value the way typing does (bypassing React's value tracker), then fire input + change. */
function emitNative(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ---------------------------------------------------------------------------------------------------------------------
// Hidden form input

/**
 * The form-facing half of a picker: an uncontrolled, visually hidden text input carrying the value. It sits under the
 * trigger so a `required` validation bubble points at the field; validation focus is passed on to the trigger.
 */
function HiddenDateInput({
  name,
  value,
  emitKey,
  valueKey,
  required,
  form,
  disabled,
  onInvalid,
  onFocus,
  onReset,
}: {
  name?: string
  value: string
  emitKey: RefObject<string | null>
  valueKey: string
  required?: boolean
  form?: string
  disabled?: boolean
  onInvalid: () => void
  onFocus: () => void
  onReset?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const last = useRef(value)
  useEffect(() => {
    const el = ref.current
    if (!el || last.current === value) return
    last.current = value
    // A change the person made: fire real events. A change from the parent (controlled update): stay silent, like
    // assigning input.value would.
    if (emitKey.current === valueKey) emitNative(el, value)
    else el.value = value
  }, [value, valueKey, emitKey])
  useEffect(() => {
    const f = ref.current?.form
    if (!f || !onReset) return
    f.addEventListener('reset', onReset)
    return () => f.removeEventListener('reset', onReset)
  }, [onReset, form])
  return (
    <input
      ref={ref}
      type="text"
      name={name}
      defaultValue={value}
      required={required}
      form={form}
      disabled={disabled}
      tabIndex={-1}
      aria-hidden
      autoComplete="off"
      onInvalid={onInvalid}
      onFocus={onFocus}
      className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Calendar panel (shared by the popover, the phone sheet and the inline calendar)

interface PanelProps {
  mode: Mode
  draft: DateRange
  onDraft: (next: DateRange, how: 'pick' | 'preset' | 'clear') => void
  today: string
  constraints: DateConstraints
  weekStartsOn: WeekStart
  marks?: readonly DateMark[]
  presets?: readonly PresetInput[]
  maxDays?: number
  months: 1 | 2
  presentation: Presentation
  clearable: boolean
  /** HUD label above the readout (the field's label). */
  title?: string | null
  titleId?: string
  /** Show Clear / Done in the panel's own footer (popover, inline). The phone sheet draws a sticky footer instead. */
  actions?: boolean
  onDone?: () => void
  /** Escape while the month chooser is open goes back to the days instead of closing. */
  escapeRef?: RefObject<(() => boolean) | null>
  autoFocus?: boolean
  headerAction?: ReactNode
  /** Readout above the months (selection + relative day / nights). Default: on for ranges and phone sheets. */
  readout?: boolean
  /** Day the calendar opens on while nothing is picked (default: today). */
  openTo?: string | null
}

function CalendarPanel({
  mode,
  draft,
  onDraft,
  today,
  constraints,
  weekStartsOn,
  marks,
  presets,
  maxDays,
  months,
  presentation,
  clearable,
  title,
  titleId,
  actions = true,
  onDone,
  escapeRef,
  autoFocus,
  headerAction,
  readout = presentation === 'sheet',
  openTo,
}: PanelProps) {
  const uid = useId()
  const density: CalendarDensity = presentation === 'sheet' ? 'large' : presentation === 'inline' ? 'regular' : 'compact'
  const c = constraints
  const anchor = draft.start ?? (isISODate(openTo) ? openTo : null)
  const [view, setView] = useState(() => {
    const m = initialMonth(anchor, today, c)
    // Two months: keep a range that ends next month in view, and never open on a month past `max`.
    return months === 2 && c.max && m === monthOf(c.max) ? addMonths(m, -1) : m
  })
  const [dir, setDir] = useState(1)
  const [focus, setFocus] = useState(() => initialFocus(anchor, today, c))
  const [hover, setHover] = useState<string | null>(null)
  const [gridFocused, setGridFocused] = useState(false)
  const [chooserYear, setChooserYear] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  const swipedAt = useRef(0)

  const shown = useMemo(() => visibleMonths(view, months), [view, months])
  const isDisabled = useCallback((d: string) => isDisabledDay(d, c), [c])
  const marksFor = useCallback((d: string) => marksOn(marks, d), [marks])

  const focusDay = useCallback((day: string) => {
    const el = rootRef.current?.querySelector<HTMLButtonElement>(`[data-page="active"] [data-day="${day}"]`)
    el?.focus({ preventScroll: true })
    return !!el
  }, [])

  // Opening: focus the selected day (or today) — the popover / sheet prevent their own autofocus for this.
  useEffect(() => {
    if (!autoFocus) return
    const id = requestAnimationFrame(() => focusDay(focus))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  // Keyboard moves: focus the new day once its month has rendered.
  useEffect(() => {
    if (pendingFocus.current && focusDay(focus)) pendingFocus.current = false
  }, [focus, view, focusDay])
  // Back from the month chooser the days mount after its exit animation: focus the day once they exist.
  const onDaysMounted = (el: HTMLDivElement | null) => {
    if (el && pendingFocus.current) requestAnimationFrame(() => focusDay(focus) && (pendingFocus.current = false))
  }

  useEffect(() => {
    if (!escapeRef) return
    escapeRef.current =
      chooserYear !== null
        ? () => {
            setChooserYear(null)
            return true
          }
        : null
  }, [chooserYear, escapeRef])

  const go = (n: number) => {
    const next = addMonths(view, n)
    if (!canShowMonth(next, c, months)) return
    setDir(n < 0 ? -1 : 1)
    setView(next)
    setHover(null)
    setFocus(clampDate(addMonthsToDate(focus, n), c.min, c.max))
  }

  const onDayKeyDown = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const next = navigateDate(day, e.key, { shift: e.shiftKey, weekStartsOn, min: c.min, max: c.max })
    if (!next) return
    e.preventDefault()
    const nv = windowFor(next, view, months)
    if (nv !== view) {
      setDir(nv > view ? 1 : -1)
      setView(nv)
    }
    if (next === focus) focusDay(next)
    else {
      pendingFocus.current = true
      setFocus(next)
    }
  }

  const pick = (day: string) => {
    if (performance.now() - swipedAt.current < 350) return
    setFocus(day)
    if (mode === 'single') onDraft({ start: day, end: day }, 'pick')
    else {
      const next = pickRange(draft, day, { maxDays })
      if (next.end) setHover(null)
      onDraft(next, 'pick')
    }
  }

  const resolved = useMemo(() => (presets?.length ? resolvePresets(presets, today, mode, c, { maxDays }) : []), [presets, today, mode, c, maxDays])
  const applyPreset = (p: { start: string; end: string }) => {
    const nv = windowFor(p.start, view, months)
    if (nv !== view) {
      setDir(nv > view ? 1 : -1)
      setView(nv)
    }
    setFocus(p.start)
    onDraft({ start: p.start, end: p.end }, 'preset')
  }

  const openChooser = () => setChooserYear((y) => (y === null ? Number(view.slice(0, 4)) : null))
  const pickMonth = (ym: string) => {
    const target = months === 2 && c.max && ym === monthOf(c.max) ? addMonths(ym, -1) : ym
    setDir(target >= view ? 1 : -1)
    setView(target)
    setFocus(clampDate(`${ym}-${pad(Math.min(Number(focus.slice(8, 10)), 28))}`, c.min, c.max))
    setChooserYear(null)
    pendingFocus.current = true
  }

  // Roving tab stop: the focused day when it is in view, else the first pickable day of the first month.
  const visibleDays = useMemo(() => shown.flatMap((m) => Array.from({ length: 31 }, (_, i) => `${m}-${pad(i + 1)}`).filter((d) => isISODate(d))), [shown])
  const tabbable = visibleDays.includes(focus) ? focus : (visibleDays.find((d) => !isDisabled(d)) ?? visibleDays[0])

  const range = mode === 'range' ? draft : undefined
  const band = mode === 'range' ? bandRange(draft, hover ?? (gridFocused && draft.start && !draft.end ? focus : null)) : null
  const legend = legendFor(marks, visibleDays)
  const canPrev = canShowMonth(addMonths(view, -1), c, months)
  const canNext = canShowMonth(addMonths(view, 1), c, months)
  const rowsHeight = DENSITY[density].px * 6 + 12 + (density === 'large' ? 36 : 32)

  // Readout: what is picked, in words.
  let headline: string
  let sub: string
  if (mode === 'single') {
    headline = draft.start ? formatDate(draft.start, 'medium') : 'No date chosen'
    sub = draft.start ? relativeDay(draft.start, today) : 'Pick a day'
  } else if (draft.start && draft.end) {
    headline = formatRange(draft.start, draft.end)
    sub = nightsLabel(draft.start, draft.end)
  } else if (draft.start) {
    headline = `${formatDate(draft.start, 'short')} – …`
    sub = maxDays ? `Now pick the last day · up to ${maxDays} days` : 'Now pick the last day'
  } else {
    headline = 'Pick the first day'
    sub = maxDays ? `Then the last day · up to ${maxDays} days` : 'Then pick the last day'
  }

  const large = density === 'large'
  const hasValue = !!draft.start
  const popover = presentation === 'popover'
  const sidebar = popover && resolved.length > 0
  const showClear = actions && presentation !== 'sheet' && clearable && hasValue
  const showDone = actions && presentation !== 'sheet' && !!onDone && mode === 'range'

  const presetButtons = resolved.map((p) => {
    const on = draft.start === p.start && (mode === 'single' || draft.end === p.end)
    const when = mode === 'single' || p.start === p.end ? formatDate(p.start, 'short') : formatRange(p.start, p.end, { year: false })
    if (sidebar) {
      return (
        <button
          key={p.key}
          type="button"
          aria-pressed={on}
          onClick={() => applyPreset(p)}
          className={cn(
            'flex w-full flex-col items-start rounded-[14px] px-3 py-2 text-left transition-[background-color,color,transform] duration-150 ease-[var(--ease-out-soft)] active:scale-[0.98]',
            on ? 'bg-ink-chip text-on-ink-chip shadow-[0_8px_18px_-10px_rgb(19_32_44/0.55)]' : 'text-ink hover:bg-chip-hover',
          )}
        >
          <span className="text-[13.5px] leading-tight font-medium">{p.label}</span>
          <span className={cn('mt-0.5 text-[12px] leading-tight tnum', on ? 'text-on-ink-chip-2' : 'text-ink-3')}>{when}</span>
        </button>
      )
    }
    return (
      <button
        key={p.key}
        type="button"
        aria-pressed={on}
        aria-label={`${p.label}, ${when}`}
        onClick={() => applyPreset(p)}
        className={cn(
          'inline-flex shrink-0 items-center rounded-full px-3.5 font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 ease-[var(--ease-out-soft)] active:scale-[0.97]',
          large ? 'h-10 text-[14px]' : 'h-8 text-[13px]',
          on ? 'bg-ink-chip text-on-ink-chip' : 'bg-chip-track text-ink hover:bg-chip-hover',
        )}
      >
        {p.label}
      </button>
    )
  })

  const clearButton = showClear ? (
    <button type="button" onClick={() => onDraft({ start: null, end: null }, 'clear')} className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-chip-hover hover:text-ink">
      Clear
    </button>
  ) : null

  const calendar = (
    <AnimatePresence mode="wait" initial={false}>
      {chooserYear !== null ? (
        <motion.div key="chooser" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={t.hover} style={{ minHeight: rowsHeight + (large ? 44 : 36) }}>
          <MonthYearChooser
            year={chooserYear}
            onYear={setChooserYear}
            canYear={(y) => (!c.min || y >= Number(c.min.slice(0, 4))) && (!c.max || y <= Number(c.max.slice(0, 4)))}
            isMonthDisabled={(ym) => !canShowMonth(ym, c)}
            selectedMonth={draft.start ? monthOf(draft.start) : null}
            currentMonth={monthOf(today)}
            onPick={pickMonth}
            density={density}
          />
        </motion.div>
      ) : (
        <motion.div
          key="days"
          ref={onDaysMounted}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={t.hover}
          onFocus={() => setGridFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGridFocused(false)
          }}
        >
          <div className={cn('mb-2 flex items-center', months === 2 ? 'gap-8' : '')}>
            {shown.map((m, i) => (
              <div key={i} className="relative flex min-w-0 flex-1 items-center justify-between gap-2">
                <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                  <motion.div key={m} initial={{ opacity: 0, x: dir * 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -12 }} transition={t.pageIn}>
                    <MonthTitle month={m} id={`${uid}-m${i}`} onClick={openChooser} expanded={false} density={density} />
                  </motion.div>
                </AnimatePresence>
                {i === shown.length - 1 ? (
                  <div className="flex shrink-0 gap-1.5">
                    <NavButton dir={-1} disabled={!canPrev} onClick={() => go(-1)} density={density} />
                    <NavButton dir={1} disabled={!canNext} onClick={() => go(1)} density={density} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <SlidingMonths
            pageKey={view}
            dir={dir}
            scope={uid}
            onSwipe={
              presentation === 'sheet'
                ? (d) => {
                    swipedAt.current = performance.now()
                    go(d)
                  }
                : undefined
            }
          >
            <div className={cn('flex', months === 2 ? 'gap-8' : '')}>
              {shown.map((m, i) => (
                <MonthGrid
                  key={m}
                  month={m}
                  weekStartsOn={weekStartsOn}
                  today={today}
                  selected={mode === 'single' ? draft.start : undefined}
                  range={range}
                  band={band}
                  tabbable={tabbable}
                  isDisabled={isDisabled}
                  marksFor={marks?.length ? marksFor : undefined}
                  onPick={pick}
                  onDayKeyDown={onDayKeyDown}
                  onDayFocus={setFocus}
                  onDayHover={mode === 'range' && draft.start && !draft.end ? setHover : undefined}
                  density={density}
                  labelledBy={`${uid}-m${i}`}
                  className="min-w-0 flex-1"
                />
              ))}
            </div>
          </SlidingMonths>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div
      ref={rootRef}
      className="flex min-w-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && chooserYear !== null && presentation === 'inline') {
          e.stopPropagation()
          setChooserYear(null)
        }
      }}
    >
      {readout || title || headerAction ? (
        <div className={cn('flex items-start justify-between gap-3', readout ? 'mb-4' : 'mb-2')}>
          <div className="min-w-0">
            {title ? (
              <p id={titleId} className="hud text-ink-2">
                {title}
              </p>
            ) : null}
            {readout ? (
              <div aria-live="polite" className={title ? 'mt-1' : undefined}>
                <p className={cn('font-display leading-tight font-light tracking-[-0.02em] text-ink tnum', large ? 'text-[26px]' : 'text-[22px]')}>{headline}</p>
                <p className="mt-0.5 text-[13px] text-ink-2 tnum">{sub}</p>
              </div>
            ) : null}
          </div>
          {headerAction}
        </div>
      ) : null}

      <div className={cn('flex min-w-0', sidebar ? 'gap-4' : 'flex-col')}>
        {sidebar ? (
          <div role="group" aria-label="Quick picks" className="flex w-[156px] shrink-0 flex-col gap-0.5 border-r border-glass-line pr-3">
            <p aria-hidden className="hud mb-1.5 px-3 pt-2 text-ink-3">
              Quick picks
            </p>
            {presetButtons}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          {calendar}
          {legend.length ? <MarkLegend marks={legend} className="mt-3" /> : null}
        </div>
      </div>

      {!sidebar && resolved.length ? (
        <div className={cn('mt-4 flex items-center gap-3', presentation === 'inline' && 'flex-wrap justify-between')}>
          <div role="group" aria-label="Quick picks" className={cn('flex min-w-0 gap-1.5', large ? '-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap')}>
            {presetButtons}
          </div>
          {presentation === 'inline' ? clearButton : null}
        </div>
      ) : presentation === 'inline' && clearButton ? (
        <div className="mt-3 flex justify-end">{clearButton}</div>
      ) : null}

      {popover ? (
        <div className="-mx-4 mt-4 -mb-4 flex min-h-[60px] items-center justify-between gap-3 border-t border-glass-line px-4 py-2.5">
          <p aria-live="polite" className="min-w-0 text-[13px] leading-snug text-ink-2 tnum">
            <span className="block truncate font-medium text-ink">{headline}</span>
            <span className="block truncate">{sub}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {clearButton}
            {showDone ? (
              <button type="button" onClick={onDone} className="inline-flex h-8 items-center rounded-full bg-ink-chip px-4 text-[13px] font-medium text-on-ink-chip shadow-[0_8px_20px_-8px_rgb(19_32_44/0.5)] transition-transform duration-150 hover:-translate-y-px active:scale-[0.98]">
                Done
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Picker shell: trigger + popover / sheet + hidden inputs

export interface DatePickerCommonProps {
  /** id of the trigger button — pass the same id to `<Field htmlFor>` and the trigger is labelled by that label. */
  id?: string
  /** Accessible label when no `<label>` points at the trigger; also the panel's HUD title. */
  label?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Draws the field in its error state (the message itself belongs in `<Field error>`, linked via aria-describedby). */
  'aria-invalid'?: boolean | 'true' | 'false'
  /** Earliest / latest selectable day (inclusive). */
  min?: string | null
  max?: string | null
  /** Any other day that cannot be picked. */
  isDateDisabled?: (date: string) => boolean
  placeholder?: string
  /** The app's today ('YYYY-MM-DD' from ctx.today) — rings today and anchors presets. Device clock if omitted. */
  today?: string
  /** Quick picks: `true` for the defaults, or a list of preset ids / custom presets. */
  presets?: boolean | readonly PresetInput[]
  /** Opening days, events, season windows… drawn under the day numbers, with text. */
  marks?: readonly DateMark[]
  /** 0 = Sunday … 6 = Saturday. Default 1 (Monday). */
  weekStartsOn?: WeekStart
  /** `field` (opaque form field, default) or `compact` / `pill` (glass pill for toolbars). */
  size?: DatePickerSize
  /** Offer Clear (default false). */
  clearable?: boolean
  disabled?: boolean
  required?: boolean
  /** Associates the hidden inputs with a form elsewhere in the document. */
  form?: string
  className?: string
  triggerClassName?: string
  /** Replace the calendar icon (e.g. a spinner while a navigation is pending); `null` hides it. */
  icon?: ReactNode
  /** Popover alignment against the trigger (md+). */
  align?: 'start' | 'center' | 'end'
  onOpenChange?: (open: boolean) => void
  /** Day the calendar opens on while the field is empty (default: today) — e.g. a trip's first day. */
  openTo?: string | null
}

export interface DatePickerProps extends DatePickerCommonProps {
  /** 'YYYY-MM-DD' or '' / null for none (controlled). */
  value?: string | null
  defaultValue?: string | null
  /** The new value ('' when cleared). */
  onChange?: (value: string) => void
  /** Hidden input name for forms. */
  name?: string
  /** Custom trigger text for a value (default "Sat 16 Jan 2027"; compact "Sat 16 Jan"). */
  renderValue?: (value: string) => ReactNode
}

export interface DateRangePickerProps extends DatePickerCommonProps {
  value?: DateRangeValue | null
  defaultValue?: DateRangeValue | null
  /** Called with complete ranges (or both '' when cleared) — never with half a range. */
  onChange?: (value: DateRangeValue) => void
  startName?: string
  endName?: string
  /** Longest range in days (inclusive); a longer pick starts a new range. */
  maxDays?: number
  /** Months side by side in the popover (default: 2 at ≥ 1024px, else 1). */
  months?: 1 | 2
  renderValue?: (value: DateRangeValue) => ReactNode
}

interface ShellProps extends DatePickerCommonProps {
  mode: Mode
  current: DateRangeValue
  isControlled: boolean
  setInner: (v: DateRangeValue) => void
  initialInner: DateRangeValue
  onCommit?: (v: DateRangeValue) => void
  names: [string | undefined, string | undefined]
  maxDays?: number
  months?: 1 | 2
  display: ReactNode
}

function PickerShell(props: ShellProps) {
  const {
    mode,
    current,
    isControlled,
    setInner,
    initialInner,
    onCommit,
    names,
    id,
    label,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    min,
    max,
    isDateDisabled,
    placeholder,
    today,
    presets,
    marks,
    weekStartsOn = 1,
    size = 'field',
    clearable = false,
    disabled,
    required,
    form,
    className,
    triggerClassName,
    icon,
    align = 'start',
    onOpenChange,
    openTo,
    maxDays,
    months,
    display,
  } = props
  const uid = useId()
  const triggerId = id ?? `${uid}-trigger`
  const valueId = `${uid}-value`
  const ownLabelId = `${uid}-own-label`
  const panelId = `${uid}-panel`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const escapeRef = useRef<(() => boolean) | null>(null)
  const emitKey = useRef<string | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const interactedOutside = useRef(false)
  const reduced = useReducedMotion()

  const [open, setOpen] = useState(false)
  const [presentation, setPresentation] = useState<'popover' | 'sheet'>('popover')
  const [monthsShown, setMonthsShown] = useState<1 | 2>(1)
  const [openToday, setOpenToday] = useState(today ?? '')
  const [labelInfo, setLabelInfo] = useState<{ ids: string; text: string }>({ ids: '', text: '' })
  const [draft, setDraft] = useState<DateRange>({ start: null, end: null })
  const [invalidShown, setInvalidShown] = useState(false)

  const constraints = useMemo<DateConstraints>(() => ({ min, max, isDateDisabled }), [min, max, isDateDisabled])
  const ownLabel = ariaLabel ?? label
  const compact = size !== 'field'
  const hasValue = !!current.start
  const invalid = ariaInvalid === true || ariaInvalid === 'true' || invalidShown

  // Label the trigger by its <label>(s) + the value, unless the caller labelled it explicitly.
  useEffect(() => {
    const el = triggerRef.current
    if (!el || ownLabel || ariaLabelledBy) return
    const { ids } = fieldLabels(el, uid)
    el.setAttribute('aria-labelledby', [...ids, valueId].join(' '))
  })

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const labelledBy = ownLabel ? `${ownLabelId} ${valueId}` : ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined

  const commit = (start: string, end: string) => {
    const next = { start, end: mode === 'range' ? end : start }
    if (next.start === current.start && next.end === current.end) return
    emitKey.current = `${next.start}|${next.end}`
    setInvalidShown(false)
    if (!isControlled) setInner(next)
    onCommit?.(next)
  }
  // Cleared after the hidden inputs' effects have run for this commit (parent effects run after children's).
  useEffect(() => {
    emitKey.current = null
  })

  const close = (refocus: boolean) => {
    window.clearTimeout(closeTimer.current)
    setOpen(false)
    onOpenChange?.(false)
    if (refocus && presentation === 'popover') triggerRef.current?.focus({ preventScroll: true })
  }
  const closeSoon = (ms: number) => {
    window.clearTimeout(closeTimer.current)
    if (reduced || ms <= 0) close(true)
    else closeTimer.current = window.setTimeout(() => close(true), ms)
  }

  const openPicker = () => {
    if (disabled) return
    const el = triggerRef.current
    const info = fieldLabels(el, uid)
    const wide = window.matchMedia('(min-width: 640px)').matches
    setPresentation(wide ? 'popover' : 'sheet')
    setMonthsShown(mode === 'range' ? (months ?? (window.matchMedia('(min-width: 1024px)').matches ? 2 : 1)) : 1)
    setOpenToday(today ?? deviceToday())
    setLabelInfo({ ids: ownLabel ? ownLabelId : (ariaLabelledBy ?? info.ids.join(' ')), text: ownLabel ?? info.text })
    setDraft({ start: current.start || null, end: (mode === 'range' ? current.end : current.start) || null })
    interactedOutside.current = false
    setOpen(true)
    onOpenChange?.(true)
  }

  const onDraft = (next: DateRange, how: 'pick' | 'preset' | 'clear') => {
    setDraft(next)
    if (presentation === 'sheet') return // the sheet commits on Done
    if (how === 'clear') {
      commit('', '')
      close(true)
    } else if (mode === 'single' && next.start) {
      commit(next.start, next.start)
      closeSoon(how === 'pick' ? 180 : 0)
    } else if (mode === 'range' && next.start && next.end) {
      commit(next.start, next.end)
      closeSoon(how === 'pick' ? 320 : 0)
    }
  }

  const done = () => {
    if (draft.start) commit(draft.start, mode === 'range' ? (draft.end ?? draft.start) : draft.start)
    else commit('', '')
    close(true)
  }

  const resolvedPresets = presets === true ? DEFAULT_PRESETS[mode] : presets || undefined
  const panelToday = today ?? openToday
  const title = labelInfo.text || (mode === 'range' ? 'Dates' : 'Date')

  const panel = (p: Presentation) => (
    <CalendarPanel
      mode={mode}
      draft={draft}
      onDraft={onDraft}
      today={panelToday}
      constraints={constraints}
      weekStartsOn={weekStartsOn}
      marks={marks}
      presets={resolvedPresets}
      maxDays={maxDays}
      months={p === 'popover' ? monthsShown : 1}
      presentation={p}
      clearable={clearable}
      title={p === 'sheet' ? title : null}
      actions={p !== 'sheet'}
      onDone={done}
      escapeRef={escapeRef}
      autoFocus
      openTo={openTo}
      headerAction={
        p === 'sheet' ? (
          <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-chip-track text-ink-2 transition-colors duration-150 hover:bg-chip-hover hover:text-ink">
            <X aria-hidden className="size-5" />
          </Dialog.Close>
        ) : undefined
      }
    />
  )

  const iconNode =
    icon === undefined ? <CalendarDays aria-hidden className={cn('shrink-0 transition-colors duration-150', compact ? 'size-4' : 'size-[18px]', open ? 'text-teal' : compact ? 'text-current' : 'text-ink-3')} /> : icon
  const showInlineClear = clearable && hasValue && !compact && !disabled

  return (
    <Popover.Root open={open && presentation === 'popover'} onOpenChange={(o) => (o ? undefined : close(!interactedOutside.current))}>
      <Popover.Anchor asChild>
        <div ref={wrapperRef} className={cn('relative min-w-0', compact ? 'inline-flex' : 'flex w-full', className)}>
          {ownLabel ? (
            <span id={ownLabelId} hidden>
              {ownLabel}
            </span>
          ) : null}
          <button
            ref={triggerRef}
            id={triggerId}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-labelledby={labelledBy}
            aria-describedby={ariaDescribedBy}
            data-invalid={invalid || undefined}
            onClick={() => (open ? close(true) : openPicker())}
            onKeyDown={(e) => {
              if (!open && (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown'))) {
                e.preventDefault()
                openPicker()
              }
            }}
            className={cn(
              'group/trigger flex min-w-0 items-center text-left tnum select-none',
              compact
                ? cn(
                    'glass-strong h-10 gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap text-ink',
                    'transition-[transform,border-color,background-color,color] duration-150 ease-[var(--ease-out-soft)] not-disabled:hover:-translate-y-px not-disabled:active:scale-[0.98]',
                    open && 'border-teal/60 text-teal',
                    'disabled:cursor-not-allowed disabled:opacity-55',
                  )
                : cn(
                    'h-11 w-full gap-2.5 rounded-[12px] border border-field-edge bg-field px-3 text-[15px] text-ink md:h-10',
                    'transition-[border-color,box-shadow] duration-150 hover:border-field-edge-hover focus-visible:outline-offset-1',
                    open && 'border-teal shadow-[0_0_0_4px_color-mix(in_srgb,var(--focus)_18%,transparent)]',
                    'disabled:cursor-not-allowed disabled:border-glass-line disabled:bg-chip-track disabled:text-ink-3 data-[invalid=true]:border-critical data-[invalid=true]:hover:border-critical',
                    showInlineClear ? 'pr-[4.5rem]' : 'pr-9',
                  ),
              triggerClassName,
            )}
          >
            {iconNode}
            <span id={valueId} className={cn('min-w-0 truncate', !hasValue && (compact ? 'text-ink-2' : 'text-ink-3'))}>
              {hasValue ? display : (placeholder ?? (mode === 'range' ? 'Add dates' : 'Pick a date'))}
            </span>
            {compact ? (
              <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 opacity-60 transition-transform duration-200', open && 'rotate-180')} />
            ) : (
              <ChevronDown aria-hidden className={cn('pointer-events-none absolute right-3 size-4 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} />
            )}
          </button>
          {showInlineClear ? (
            <button
              type="button"
              aria-label={mode === 'range' ? 'Clear dates' : 'Clear date'}
              onClick={() => {
                commit('', '')
                triggerRef.current?.focus()
              }}
              className="absolute top-1/2 right-8 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-chip-hover hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
          {names[0] || required ? (
            <HiddenDateInput
              name={names[0]}
              value={current.start}
              valueKey={`${current.start}|${current.end}`}
              emitKey={emitKey}
              required={required}
              form={form}
              disabled={disabled}
              onInvalid={() => setInvalidShown(true)}
              onFocus={() => triggerRef.current?.focus()}
              onReset={isControlled ? undefined : () => setInner(initialInner)}
            />
          ) : null}
          {mode === 'range' && (names[1] || required) ? (
            <HiddenDateInput
              name={names[1]}
              value={current.end}
              valueKey={`${current.start}|${current.end}`}
              emitKey={emitKey}
              required={required}
              form={form}
              disabled={disabled}
              onInvalid={() => setInvalidShown(true)}
              onFocus={() => triggerRef.current?.focus()}
            />
          ) : null}
        </div>
      </Popover.Anchor>

      <AnimatePresence>
        {open && presentation === 'popover' ? (
          <Popover.Portal forceMount>
            <Popover.Content
              forceMount
              asChild
              id={panelId}
              side="bottom"
              align={align}
              sideOffset={8}
              collisionPadding={12}
              aria-labelledby={labelInfo.ids || undefined}
              aria-label={labelInfo.ids ? undefined : title}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => {
                if (escapeRef.current?.()) e.preventDefault()
              }}
              onInteractOutside={(e) => {
                if (wrapperRef.current?.contains(e.target as Node)) e.preventDefault()
                else interactedOutside.current = true
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.14, ease: t.pageIn.ease } }}
                transition={t.pageIn}
                className="glass-strong z-[60] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain rounded-[24px] bg-surface/[0.96] p-4 text-ink shadow-[var(--glass-shadow-lg)] outline-none scrollbar-thin"
                style={{ transformOrigin: 'var(--radix-popover-content-transform-origin)', width: `min(calc(100vw - 24px), ${(monthsShown === 2 ? 672 : 344) + (resolvedPresets?.length ? 172 : 0)}px)` }}
              >
                {panel('popover')}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        ) : null}
      </AnimatePresence>

      <Dialog.Root open={open && presentation === 'sheet'} onOpenChange={(o) => (o ? undefined : close(false))}>
        <Dialog.Portal>
          <Dialog.Overlay className="piste-overlay fixed inset-0 z-[60] bg-overlay backdrop-blur-[3px]" />
          <Dialog.Content
            id={panelId}
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              triggerRef.current?.focus({ preventScroll: true })
            }}
            onEscapeKeyDown={(e) => {
              if (escapeRef.current?.()) e.preventDefault()
            }}
            className="piste-sheet glass-strong fixed inset-x-0 bottom-0 z-[60] flex max-h-[94dvh] flex-col rounded-t-[28px] border-b-0 text-ink shadow-[var(--glass-shadow-lg)] outline-none"
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-field-edge" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 scrollbar-thin">{panel('sheet')}</div>
            <div className="safe-bottom sticky bottom-0 flex shrink-0 items-center gap-2 border-t border-glass-line px-4 pt-3 pb-3">
              {clearable && draft.start ? (
                <button type="button" onClick={() => setDraft({ start: null, end: null })} className="inline-flex h-12 items-center rounded-full px-5 text-[15px] font-medium text-ink-2 transition-colors duration-150 hover:bg-chip-hover hover:text-ink">
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={done}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-ink-chip px-5 text-[15px] font-semibold text-on-ink-chip shadow-[0_10px_24px_-10px_rgb(19_32_44/0.55)] transition-transform duration-150 active:scale-[0.98]"
              >
                {mode === 'range' && draft.start && !draft.end ? `Done · ${formatDate(draft.start, 'short')} only` : 'Done'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Public components

/** One day. Value: 'YYYY-MM-DD' ('' when empty). */
export function DatePicker({ value, defaultValue, onChange, name, renderValue, ...rest }: DatePickerProps) {
  const isControlled = value !== undefined
  const initial = useMemo(() => ({ start: norm(defaultValue), end: norm(defaultValue) }), [defaultValue])
  const [inner, setInner] = useState<DateRangeValue>(initial)
  const v = isControlled ? norm(value) : inner.start
  const current = useMemo(() => ({ start: v, end: v }), [v])
  const compact = rest.size === 'compact' || rest.size === 'pill'
  return (
    <PickerShell
      {...rest}
      mode="single"
      current={current}
      isControlled={isControlled}
      setInner={setInner}
      initialInner={initial}
      onCommit={(n) => onChange?.(n.start)}
      names={[name, undefined]}
      display={v ? (renderValue ? renderValue(v) : formatDate(v, compact ? 'short' : 'medium')) : null}
    />
  )
}

/** A start and an end day. `onChange` gets complete ranges only (or both '' when cleared). */
export function DateRangePicker({ value, defaultValue, onChange, startName, endName, renderValue, maxDays, months, ...rest }: DateRangePickerProps) {
  const isControlled = value !== undefined
  const initial = useMemo(() => ({ start: norm(defaultValue?.start), end: norm(defaultValue?.end) }), [defaultValue?.start, defaultValue?.end])
  const [inner, setInner] = useState<DateRangeValue>(initial)
  const s = isControlled ? norm(value?.start) : inner.start
  const e = isControlled ? norm(value?.end) : inner.end
  const current = useMemo(() => ({ start: s, end: e }), [s, e])
  const compact = rest.size === 'compact' || rest.size === 'pill'
  return (
    <PickerShell
      {...rest}
      mode="range"
      current={current}
      isControlled={isControlled}
      setInner={setInner}
      initialInner={initial}
      onCommit={(n) => onChange?.(n)}
      names={[startName, endName]}
      maxDays={maxDays}
      months={months}
      display={s ? (renderValue ? renderValue(current) : formatRange(s, e || null, { year: !compact })) : null}
    />
  )
}

interface CalendarCommonProps {
  today: string
  min?: string | null
  max?: string | null
  isDateDisabled?: (date: string) => boolean
  marks?: readonly DateMark[]
  presets?: boolean | readonly PresetInput[]
  weekStartsOn?: WeekStart
  clearable?: boolean
  /** HUD label above the calendar. */
  label?: string
  /** Show the selection readout above the months (default: ranges only). */
  readout?: boolean
  months?: 1 | 2
  className?: string
}

export type CalendarProps = CalendarCommonProps &
  (
    | { mode?: 'single'; value: string | null; onChange: (value: string) => void; maxDays?: never }
    | {
        mode: 'range'
        value: { start: string | null; end: string | null } | null
        /** Every change, including a start alone (end '' until the last day is picked). */
        onChange: (value: DateRangeValue) => void
        maxDays?: number
      }
  )

/**
 * The calendar on the page, without a trigger (cards, sheets that are all about dates). Controlled; same visuals,
 * keyboard and marks as the pickers.
 */
export function Calendar(props: CalendarProps) {
  const { today, min, max, isDateDisabled, marks, presets, weekStartsOn = 1, clearable = false, label, readout, months = 1, className } = props
  const uid = useId()
  const constraints = useMemo<DateConstraints>(() => ({ min, max, isDateDisabled }), [min, max, isDateDisabled])
  const mode: Mode = props.mode === 'range' ? 'range' : 'single'
  const draft: DateRange =
    props.mode === 'range' ? { start: norm(props.value?.start) || null, end: norm(props.value?.end) || null } : { start: norm(props.value) || null, end: norm(props.value) || null }
  const onDraft = (next: DateRange) => {
    if (props.mode === 'range') props.onChange({ start: next.start ?? '', end: next.end ?? '' })
    else props.onChange(next.start ?? '')
  }
  return (
    <div className={className}>
      <CalendarPanel
        mode={mode}
        draft={draft}
        onDraft={onDraft}
        today={today}
        constraints={constraints}
        weekStartsOn={weekStartsOn}
        marks={marks}
        presets={presets === true ? DEFAULT_PRESETS[mode] : presets || undefined}
        maxDays={props.mode === 'range' ? props.maxDays : undefined}
        months={months}
        presentation="inline"
        clearable={clearable}
        title={label}
        titleId={`${uid}-title`}
        readout={readout}
      />
    </div>
  )
}
