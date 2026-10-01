'use client'
/**
 * Log / edit a ski day: date, resort, trip, hours, my 1–5 rating, the surface I found (optionally also saved as my
 * personal surface report for that resort and date — never an official report), the time of day I liked, the crowd
 * — clearly my guess —, skills practised, a spend note and notes. With a pass of mine on file, the day can be logged
 * as a pass day too. Saving closes the sheet with a checkmark toast; the journal marks the new entry briefly.
 */
import { useId, useMemo, useState, useTransition, type ReactNode } from 'react'
import { Check, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { Notice } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { deleteSkiDay, restoreSkiDay, saveSkiDay } from '@/lib/actions/season'
import type { SkiDayView } from '@/lib/data/season'
import { SURFACE_LABEL, SURFACE_TAGS, type SurfaceTag } from '@/lib/domain/types'
import { CROWD_PRESETS, RATING_WORDS, TIME_PRESETS, currencies, dayLabel, majorString, rangeLabel } from './format'
import type { SeasonUiData } from './season-ui'

export interface DayPrefill {
  resortId?: string | null
  date?: string | null
  tripId?: string | null
  /** A pass day already logged in Passes for this resort and date. */
  passOwnershipId?: number | null
}

const CHOOSABLE: SurfaceTag[] = SURFACE_TAGS.filter((t) => t !== 'unknown')

interface Form {
  date: string
  resortId: string
  tripId: string
  hours: string
  vertical: string
  rating: number | null
  surface: SurfaceTag[]
  saveReport: boolean
  preferredTime: string
  crowdGuess: string
  skills: number[]
  spend: string
  currency: string
  notes: string
  passOwnershipId: number | null
}

function initialForm(data: SeasonUiData, day: SkiDayView | null, prefill: DayPrefill | undefined): Form {
  if (day) {
    return {
      date: day.date,
      resortId: day.resortId,
      tripId: day.tripId ?? '',
      hours: day.hoursSkied != null ? String(day.hoursSkied) : '',
      vertical: day.verticalM != null ? String(Math.round(data.elevationUnit === 'ft' ? day.verticalM / 0.3048 : day.verticalM)) : '',
      rating: day.rating,
      surface: day.surfaceFeedback.filter((t) => t !== 'unknown'),
      saveReport: false,
      preferredTime: day.preferredTime ?? '',
      crowdGuess: day.crowdGuess ?? '',
      skills: day.skillsPracticed.map((k) => k.id),
      spend: majorString(day.spend),
      currency: day.spend?.currency ?? data.currency,
      notes: day.notes ?? '',
      passOwnershipId: day.passDay?.ownershipId ?? null,
    }
  }
  const resortId = prefill?.resortId && data.resorts.some((r) => r.id === prefill.resortId) ? prefill.resortId : ''
  const date = prefill?.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : data.today
  return {
    date,
    resortId,
    tripId: prefill?.tripId && data.trips.some((t) => t.id === prefill.tripId) ? prefill.tripId : '',
    hours: '',
    vertical: '',
    rating: null,
    surface: [],
    saveReport: false,
    preferredTime: '',
    crowdGuess: '',
    skills: [],
    spend: '',
    currency: data.currency,
    notes: '',
    passOwnershipId: prefill?.passOwnershipId && data.passOptions.some((p) => p.ownershipId === prefill.passOwnershipId) ? prefill.passOwnershipId : null,
  }
}

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border-t border-divider pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left w-full text-[15px] font-semibold text-ink">{title}</legend>
      {hint ? <p className="-mt-2 text-[12.5px] text-ink-3">{hint}</p> : null}
      {children}
    </fieldset>
  )
}

const chip =
  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors duration-150 select-none md:min-h-9 ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus'

function ToggleChip({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <label className={cn(chip, on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal')}>
      <input type="checkbox" className="sr-only" checked={on} onChange={onToggle} />
      {on ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : null}
      {children}
    </label>
  )
}

function PresetChips({ label, options, value, onPick }: { label: string; options: readonly string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.trim().toLowerCase() === o.toLowerCase()
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? '' : o)}
            className={cn(
              'inline-flex h-11 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 md:h-8',
              on ? 'border-teal bg-glacier text-teal' : 'border-divider bg-surface-2 text-ink-2 hover:border-teal hover:text-ink',
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function RatingPicker({ value, onChange, error }: { value: number | null; onChange: (v: number | null) => void; error?: string }) {
  const name = useId()
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <fieldset>
      <legend className="text-[13.5px] font-medium text-ink">
        My rating of the day <span className="font-normal text-ink-3">(optional)</span>
      </legend>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-2" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            onMouseEnter={() => setHover(n)}
            className="relative inline-flex size-11 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-surface-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus md:size-9"
          >
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <Star aria-hidden className={cn('size-6 transition-colors duration-150 md:size-[22px]', n <= shown ? 'fill-copper text-copper' : 'text-divider-strong')} strokeWidth={1.6} />
            <span className="sr-only">
              {n} of 5 — {RATING_WORDS[n]}
            </span>
          </label>
        ))}
        <span className="ml-2 text-[13.5px] text-ink-2" aria-live="polite">
          {hover ? RATING_WORDS[hover] : value ? RATING_WORDS[value] : 'Not rated'}
        </span>
        {value ? (
          <button type="button" onClick={() => onChange(null)} className="ml-1 inline-flex h-11 items-center rounded-md px-2 text-[13px] font-medium text-teal hover:underline md:h-8">
            Clear
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] font-medium text-critical">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

export function DaySheet({
  open,
  onOpenChange,
  data,
  day,
  prefill,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: SeasonUiData
  day: SkiDayView | null
  prefill?: DayPrefill
  onSaved: (id: number, created: boolean) => void
  onCloseAutoFocus?: (e: Event) => void
}) {
  const toast = useToast()
  const formId = useId()
  const ids = { date: useId(), resort: useId(), trip: useId(), hours: useId(), vertical: useId(), time: useId(), crowd: useId(), spend: useId(), currency: useId(), notes: useId(), pass: useId(), report: useId() }
  const [f, setF] = useState<Form>(() => initialForm(data, day, prefill))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  const resort = data.resorts.find((r) => r.id === f.resortId) ?? null
  const maxDate = resort?.today ?? data.today
  const favorites = data.resorts.filter((r) => r.favorite)
  const others = data.resorts.filter((r) => !r.favorite)
  const tripsForDay = data.trips.filter((t) => (f.date >= t.startDate && f.date <= t.endDate) || t.id === f.tripId)
  const hasReport = !!resort && data.personalReports.includes(`${resort.id}|${f.date}`)
  const skillGroups = useMemo(() => {
    const m = new Map<string, SeasonUiData['skills']>()
    for (const k of data.skills) m.set(k.category ?? 'Other', [...(m.get(k.category ?? 'Other') ?? []), k])
    return [...m]
  }, [data.skills])
  const pass = data.passOptions
  const resortName = resort?.shortName ?? 'this resort'

  const submit = () => {
    const errs: Record<string, string> = {}
    const hours = f.hours.trim() ? Number(f.hours.trim().replace(',', '.')) : null
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 14)) errs.hoursSkied = 'Use hours between 0.25 and 14 (e.g. 3.5)'
    const vRaw = f.vertical.trim() ? Number(f.vertical.trim().replace(/[,\s]/g, '')) : null
    const verticalM = vRaw !== null && Number.isFinite(vRaw) ? (data.elevationUnit === 'ft' ? vRaw * 0.3048 : vRaw) : null
    if (vRaw !== null && (!Number.isFinite(vRaw) || vRaw <= 0 || (verticalM ?? 0) > 30000)) errs.verticalM = `Use a number of ${data.elevationUnit === 'ft' ? 'feet' : 'metres'} above 0`
    if (!f.resortId) errs.resortId = 'Choose where you skied'
    if (!f.date) errs.date = 'Pick the day'
    if (Object.keys(errs).length) {
      setErrors(errs)
      setError('Please check the highlighted fields')
      return
    }
    start(async () => {
      setError(null)
      setErrors({})
      const r = await saveSkiDay({
        id: day?.id ?? null,
        date: f.date,
        resortId: f.resortId,
        tripId: f.tripId || null,
        hoursSkied: hours,
        verticalM,
        rating: f.rating,
        surfaceFeedback: f.surface,
        preferredTime: f.preferredTime,
        crowdGuess: f.crowdGuess,
        skillsPracticed: f.skills,
        spend: f.spend.trim() || null,
        currency: f.spend.trim() ? f.currency : null,
        notes: f.notes,
        passOwnershipId: f.passOwnershipId,
        saveReport: f.saveReport && f.surface.length > 0,
      })
      if (!r.ok) {
        setError(r.error)
        setErrors(r.fieldErrors ?? {})
        return
      }
      onSaved(r.data.id, r.data.created)
      onOpenChange(false)
      toast.show(r.message ?? 'Saved')
      if (r.data.passWarning) toast.show(r.data.passWarning, { tone: 'info', durationMs: 9000 })
    })
  }

  const remove = () => {
    if (!day) return
    start(async () => {
      const r = await deleteSkiDay({ id: day.id })
      if (!r.ok) {
        setError(r.error)
        return
      }
      onOpenChange(false)
      const snapshot = r.data.snapshot
      toast.show(r.message ?? 'Day removed', {
        undo: async () => {
          const back = await restoreSkiDay({ snapshot })
          toast.show(back.ok ? 'Day restored' : back.error, { tone: back.ok ? 'success' : 'error' })
        },
      })
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={day ? `${day.resortName} · ${dayLabel(day.date)}` : 'Log a ski day'}
      description={day ? 'Edit this day in your journal.' : 'A day you skied — for your journal, your skills and your season totals.'}
      widthClass="md:w-[560px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {day ? (
            <Button variant="danger" onClick={remove} disabled={pending} className="h-11 md:h-10">
              <Trash2 aria-hidden className="size-4" /> Delete day
            </Button>
          ) : (
            <p className="text-[12.5px] text-ink-3">{data.demo ? 'Demo mode — saved to the demo database only.' : 'Private to you.'}</p>
          )}
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="ml-auto h-11 md:h-10">
            {pending ? 'Saving…' : day ? 'Save changes' : 'Log this day'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {error ? <Notice tone="error" title={error} /> : null}

        <Group title="The day">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <Field label="Date" htmlFor={ids.date} error={errors.date} hint={resort ? `Up to ${dayLabel(maxDate)} at ${resortName}` : undefined}>
              <TextInput id={ids.date} type="date" required value={f.date} max={maxDate} onChange={(e) => set('date', e.target.value)} className="tnum" aria-invalid={!!errors.date} />
            </Field>
            <Field label="Resort" htmlFor={ids.resort} error={errors.resortId}>
              <Select id={ids.resort} required value={f.resortId} onChange={(e) => set('resortId', e.target.value)} aria-invalid={!!errors.resortId}>
                <option value="">Choose a resort…</option>
                {favorites.length ? (
                  <optgroup label="Favourites">
                    {favorites.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={favorites.length ? 'All resorts' : 'Resorts'}>
                  {others.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4">
            <Field label="Trip" htmlFor={ids.trip} optional error={errors.tripId} hint={tripsForDay.length ? undefined : 'No trip covers this day.'}>
              <Select id={ids.trip} value={f.tripId} disabled={!tripsForDay.length} onChange={(e) => set('tripId', e.target.value)} aria-invalid={!!errors.tripId}>
                <option value="">Not part of a trip</option>
                {tripsForDay.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {rangeLabel(t.startDate, t.endDate)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hours on snow" htmlFor={ids.hours} optional error={errors.hoursSkied}>
                <TextInput id={ids.hours} inputMode="decimal" placeholder="e.g. 3.5" value={f.hours} onChange={(e) => set('hours', e.target.value)} className="tnum" aria-invalid={!!errors.hoursSkied} />
              </Field>
              <Field label={`Vertical (${data.elevationUnit})`} htmlFor={ids.vertical} optional error={errors.verticalM} hint="From your watch or app, if it tracked the day.">
                <TextInput
                  id={ids.vertical}
                  inputMode="numeric"
                  placeholder={data.elevationUnit === 'ft' ? 'e.g. 6500' : 'e.g. 2000'}
                  value={f.vertical}
                  onChange={(e) => set('vertical', e.target.value)}
                  className="tnum"
                  aria-invalid={!!errors.verticalM}
                />
              </Field>
            </div>
          </div>
          <RatingPicker value={f.rating} onChange={(v) => set('rating', v)} error={errors.rating} />
        </Group>

        <Group title="On the snow" hint="Your own observations — kept as personal notes, apart from official reports.">
          <fieldset>
            <legend className="text-[13.5px] font-medium text-ink">
              Surface I found <span className="font-normal text-ink-3">(optional)</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHOOSABLE.map((t) => {
                const on = f.surface.includes(t)
                return (
                  <ToggleChip key={t} on={on} onToggle={() => set('surface', on ? f.surface.filter((x) => x !== t) : [...f.surface, t])}>
                    {SURFACE_LABEL[t]}
                  </ToggleChip>
                )
              })}
            </div>
            {errors.surfaceFeedback ? (
              <p role="alert" className="mt-1 text-[12.5px] font-medium text-critical">
                {errors.surfaceFeedback}
              </p>
            ) : null}
          </fieldset>
          <div className={cn('rounded-[10px] border px-3.5 py-3 transition-colors duration-150', f.saveReport && f.surface.length ? 'border-teal/50 bg-glacier/50' : 'border-divider bg-surface-2')}>
            <div className="flex items-start gap-3">
              <input
                id={ids.report}
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--teal)] disabled:opacity-50"
                checked={f.saveReport && f.surface.length > 0}
                disabled={!f.surface.length || !resort}
                onChange={(e) => set('saveReport', e.target.checked)}
              />
              <label htmlFor={ids.report} className="text-[14px] text-ink">
                Also save it as my personal surface report
                <span className="mt-0.5 block text-[12.5px] text-ink-3">
                  {!f.surface.length || !resort
                    ? 'Pick a resort and at least one surface tag first.'
                    : `Shows on the ${resortName} page for ${dayLabel(f.date)} as your own observation — never as an official report, and never as evidence the resort was open.${hasReport ? ' You saved one for this day already; this adds a new revision.' : ''}`}
                </span>
              </label>
            </div>
          </div>
          <Field label="Best time of day" htmlFor={ids.time} optional error={errors.preferredTime}>
            <PresetChips label="Time of day presets" options={TIME_PRESETS} value={f.preferredTime} onPick={(v) => set('preferredTime', v)} />
            <TextInput id={ids.time} value={f.preferredTime} maxLength={80} onChange={(e) => set('preferredTime', e.target.value)} placeholder="e.g. Morning, before it got tracked out" aria-invalid={!!errors.preferredTime} />
          </Field>
          <Field label="Crowds — your guess" htmlFor={ids.crowd} optional error={errors.crowdGuess} hint="A guess from the day, not a measurement. Piste never shows live queues or crowd counts.">
            <PresetChips label="Crowd guess presets" options={CROWD_PRESETS} value={f.crowdGuess} onPick={(v) => set('crowdGuess', v)} />
            <TextInput id={ids.crowd} value={f.crowdGuess} maxLength={120} onChange={(e) => set('crowdGuess', e.target.value)} placeholder="e.g. Busy — holiday week" aria-invalid={!!errors.crowdGuess} />
          </Field>
        </Group>

        <Group title="Skills practised" hint="Ticking a skill here records practice; its status on your checklist only changes when you change it.">
          {data.skills.length ? (
            <div className="flex flex-col gap-3">
              {skillGroups.map(([cat, list]) => (
                <div key={cat} role="group" aria-label={cat}>
                  <p className="mb-1.5 text-[12px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{cat}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((k) => {
                      const on = f.skills.includes(k.id)
                      return (
                        <ToggleChip key={k.id} on={on} onToggle={() => set('skills', on ? f.skills.filter((x) => x !== k.id) : [...f.skills, k.id])}>
                          {k.label}
                        </ToggleChip>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-3">Your learning checklist is empty — add skills under Learning.</p>
          )}
        </Group>

        <Group title="Notes, spend and pass">
          <Field label="Notes" htmlFor={ids.notes} optional error={errors.notes}>
            <Textarea id={ids.notes} rows={4} maxLength={4000} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What went well, what to work on next time…" aria-invalid={!!errors.notes} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)]">
            <Field
              label="Spend on the day"
              htmlFor={ids.spend}
              optional
              error={errors.spend}
              hint="A note for the journal — not added to the season budget. Record costs under Spending to count them."
            >
              <TextInput id={ids.spend} inputMode="decimal" placeholder="e.g. 64.50" value={f.spend} onChange={(e) => set('spend', e.target.value)} className="tnum" aria-invalid={!!errors.spend} />
            </Field>
            <Field label="Currency" htmlFor={ids.currency} error={errors.currency}>
              <Select id={ids.currency} value={f.currency} onChange={(e) => set('currency', e.target.value)} disabled={!f.spend.trim()}>
                {currencies(data.currency, f.currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {pass.length === 1 ? (
            <div className="flex items-start gap-3">
              <input
                id={ids.pass}
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--teal)]"
                checked={f.passOwnershipId === pass[0].ownershipId}
                onChange={(e) => set('passOwnershipId', e.target.checked ? pass[0].ownershipId : null)}
              />
              <label htmlFor={ids.pass} className="text-[14px] text-ink">
                I skied on my {pass[0].productName}
                <span className="mt-0.5 block text-[12.5px] text-ink-3">
                  {day?.passDay && f.passOwnershipId === null ? 'Unticking removes this pass day from Passes & Costs.' : 'Logs a pass day in Passes & Costs, so days left stay right. Pass days add no lift cost to your budget.'}
                </span>
              </label>
            </div>
          ) : pass.length > 1 ? (
            <Field label="Pass used" htmlFor={ids.pass} optional hint="Logs a pass day in Passes & Costs. Pass days add no lift cost to your budget.">
              <Select id={ids.pass} value={f.passOwnershipId ?? ''} onChange={(e) => set('passOwnershipId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">No pass — ticket or other</option>
                {pass.map((p) => (
                  <option key={p.ownershipId} value={p.ownershipId}>
                    {p.productName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </Group>
      </form>
    </Sheet>
  )
}
