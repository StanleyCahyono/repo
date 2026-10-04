'use client'
/**
 * Lesson planner: planned, unscheduled and past lessons — resort, date, type, instructor, focus skills (from the
 * checklist), booking reference and link, and my estimated / quoted / actual cost. Lessons planned inside a trip are
 * edited in that trip (it keeps the itinerary and budget in step and mirrors them here); the rest are edited here.
 * A lesson's cost is for planning — what I paid counts in the budget when it is recorded as an expense.
 */
import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, GraduationCap, PencilLine, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { KindTag, Missing } from '@/components/ui/provenance'
import { Sheet } from '@/components/ui/sheet'
import { Notice } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { deleteLesson, restoreLesson, saveLesson } from '@/lib/actions/season'
import type { LessonView, SeasonView } from '@/lib/data/season'
import type { ChecklistSkill, PickerResort } from '@/lib/data/season-screen'
import { formatLocalDate } from '@/lib/domain/time'
import { COST_KIND_LABEL, LESSON_KINDS, LESSON_KIND_LABEL, currencies, majorString, money, resortHref, tripHref } from './format'
import { Rise } from './rise'
import { useSeasonUi } from './season-ui'
import { useDateMarks } from './date-marks'

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

interface LessonForm {
  resortId: string
  date: string
  kind: string
  instructor: string
  focus: number[]
  bookingRef: string
  bookingUrl: string
  cost: string
  currency: string
  costKind: string
  notes: string
}

function LessonSheet({
  open,
  onOpenChange,
  onCloseAutoFocus,
  lesson,
  resorts,
  skills,
  currency,
  demo,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCloseAutoFocus?: (e: Event) => void
  lesson: LessonView | null
  resorts: PickerResort[]
  skills: ChecklistSkill[]
  currency: string
  demo: boolean
}) {
  const toast = useToast()
  const formId = useId()
  const { today } = useSeasonUi().data
  const marks = useDateMarks()
  const ids = { resort: useId(), date: useId(), kind: useId(), instructor: useId(), ref: useId(), url: useId(), cost: useId(), cur: useId(), costKind: useId(), notes: useId() }
  const [f, setF] = useState<LessonForm>(() =>
    lesson
      ? {
          resortId: lesson.resortId,
          date: lesson.date ?? '',
          kind: lesson.kind ?? '',
          instructor: lesson.instructor ?? '',
          focus: lesson.focusSkills.map((k) => k.id),
          bookingRef: lesson.bookingRef ?? '',
          bookingUrl: lesson.bookingUrl ?? '',
          cost: majorString(lesson.cost),
          currency: lesson.cost?.currency ?? currency,
          costKind: lesson.costKind ?? 'estimate',
          notes: lesson.notes ?? '',
        }
      : { resortId: '', date: '', kind: 'group', instructor: '', focus: [], bookingRef: '', bookingUrl: '', cost: '', currency, costKind: 'estimate', notes: '' },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof LessonForm>(k: K, v: LessonForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const open2 = skills.filter((k) => k.status !== 'self-confirmed' && k.status !== 'instructor-confirmed')
  const done = skills.filter((k) => k.status === 'self-confirmed' || k.status === 'instructor-confirmed')

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={lesson ? 'Edit lesson' : 'Plan a lesson'}
      description="Lessons outside a trip. To add one to a trip’s itinerary and budget, add it from the trip."
      widthClass="md:w-[520px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {lesson ? (
            <Button
              variant="danger"
              disabled={pending}
              className="h-11 md:h-10"
              onClick={() =>
                start(async () => {
                  const r = await deleteLesson({ id: lesson.id })
                  if (!r.ok) {
                    setError(r.error)
                    return
                  }
                  onOpenChange(false)
                  const snapshot = r.data.snapshot
                  toast.show(r.message ?? 'Lesson removed', {
                    undo: async () => {
                      const back = await restoreLesson({ snapshot })
                      if (!back.ok) toast.show(back.error, { tone: 'error' })
                    },
                  })
                })
              }
            >
              <Trash2 aria-hidden className="size-4" /> Remove
            </Button>
          ) : (
            <p className="text-[12.5px] text-ink-3">{demo ? 'Demo mode — saved to the demo database only.' : 'Nothing is booked from here.'}</p>
          )}
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="ml-auto h-11 md:h-10">
            {pending ? 'Saving…' : lesson ? 'Save changes' : 'Add lesson'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            setError(null)
            setErrors({})
            const r = await saveLesson({
              id: lesson?.id ?? null,
              resortId: f.resortId,
              date: f.date || null,
              kind: (f.kind || null) as (typeof LESSON_KINDS)[number] | null,
              instructor: f.instructor,
              focusSkills: f.focus,
              bookingRef: f.bookingRef,
              bookingUrl: f.bookingUrl.trim() || null,
              cost: f.cost.trim() || null,
              currency: f.cost.trim() ? f.currency : null,
              costKind: f.cost.trim() ? (f.costKind as 'quote' | 'estimate' | 'actual') : null,
              notes: f.notes,
            })
            if (!r.ok) {
              setError(r.error)
              setErrors(r.fieldErrors ?? {})
              return
            }
            onOpenChange(false)
            toast.show(r.message ?? 'Saved')
          })
        }}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <Field label="Resort" htmlFor={ids.resort} error={errors.resortId}>
            <Select id={ids.resort} value={f.resortId} onChange={(e) => set('resortId', e.target.value)} aria-invalid={!!errors.resortId}>
              <option value="">Choose a resort…</option>
              {resorts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor={ids.date} optional error={errors.date} hint="Leave empty if not scheduled yet.">
            <DatePicker id={ids.date} value={f.date} today={today} marks={marks} clearable placeholder="Not scheduled" onChange={(v) => set('date', v)} aria-invalid={!!errors.date} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor={ids.kind} optional>
            <Select id={ids.kind} value={f.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="">Not decided</option>
              {LESSON_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LESSON_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Instructor" htmlFor={ids.instructor} optional error={errors.instructor}>
            <TextInput id={ids.instructor} value={f.instructor} maxLength={120} onChange={(e) => set('instructor', e.target.value)} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-[13.5px] font-medium text-ink">
            Focus skills <span className="font-normal text-ink-3">(optional)</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...open2, ...done].map((k) => {
              const on = f.focus.includes(k.id)
              return (
                <label
                  key={k.id}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-[13px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus md:min-h-9',
                    on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal',
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => set('focus', on ? f.focus.filter((x) => x !== k.id) : [...f.focus, k.id])} />
                  {k.label}
                </label>
              )
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <Field label="Booking ref" htmlFor={ids.ref} optional error={errors.bookingRef}>
            <TextInput id={ids.ref} value={f.bookingRef} maxLength={80} onChange={(e) => set('bookingRef', e.target.value)} className="font-mono text-[14px]" />
          </Field>
          <Field label="Booking or school link" htmlFor={ids.url} optional error={errors.bookingUrl}>
            <TextInput id={ids.url} type="url" inputMode="url" value={f.bookingUrl} onChange={(e) => set('bookingUrl', e.target.value)} placeholder="https://" aria-invalid={!!errors.bookingUrl} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
          <Field label="Cost" htmlFor={ids.cost} optional error={errors.cost} className="col-span-2 sm:col-span-1">
            <TextInput id={ids.cost} inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} placeholder="e.g. 79" className="tnum" aria-invalid={!!errors.cost} />
          </Field>
          <Field label="Currency" htmlFor={ids.cur} error={errors.currency}>
            <Select id={ids.cur} value={f.currency} disabled={!f.cost.trim()} onChange={(e) => set('currency', e.target.value)}>
              {currencies(currency, f.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kind" htmlFor={ids.costKind} error={errors.costKind}>
            <Select id={ids.costKind} value={f.costKind} disabled={!f.cost.trim()} onChange={(e) => set('costKind', e.target.value)}>
              <option value="estimate">Estimate</option>
              <option value="quote">Quote</option>
              <option value="actual">Actual</option>
            </Select>
          </Field>
        </div>
        <p className="-mt-2 text-[12.5px] text-ink-3">For planning. To count what you paid in the season budget, add it under Spending.</p>
        <Field label="Notes" htmlFor={ids.notes} optional error={errors.notes}>
          <Textarea id={ids.notes} rows={3} maxLength={2000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

function LessonRow({ l, index, demo, onEdit }: { l: LessonView; index: number; demo: boolean; onEdit: (l: LessonView, from: HTMLElement) => void }) {
  const title = l.kind ? (LESSON_KIND_LABEL[l.kind] ?? l.kind) : 'Lesson'
  return (
    <Rise as="li" index={index} className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 px-4 py-4 transition-colors duration-150 hover:bg-surface-2/60 md:grid-cols-[56px_minmax(0,1fr)_auto] md:px-5">
      <div className="leading-none">
        {l.date ? (
          <>
            <p className="font-display text-[30px] text-ink tnum">{formatLocalDate(l.date, 'd')}</p>
            <p className="mt-1 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{formatLocalDate(l.date, 'LLL')}</p>
          </>
        ) : (
          <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full border border-dashed border-divider-strong text-ink-3">
            <GraduationCap className="size-5" strokeWidth={1.6} />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[15.5px] leading-snug font-semibold text-ink">
          {title} <span className="font-normal text-ink-2">at</span>{' '}
          <Link href={resortHref(l.resortId)} className="underline-offset-4 hover:text-teal hover:underline">
            {l.resortName}
          </Link>
          {demo ? <KindTag kind="demo" className="ml-2 align-[1px]" /> : null}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {l.date ? formatLocalDate(l.date, 'cccc d LLLL yyyy') : <span className="italic text-ink-3">Not scheduled yet</span>}
          {l.instructor ? <> · with {l.instructor}</> : null}
        </p>
        {l.focusSkills.length ? (
          <p className="mt-2 flex flex-wrap gap-1.5">
            <span className="sr-only">Focus skills:</span>
            {l.focusSkills.map((k) => (
              <span key={k.id} className="inline-flex h-7 items-center rounded-full border border-divider bg-surface-2 px-2.5 text-[12.5px] text-ink">
                {k.label}
              </span>
            ))}
          </p>
        ) : null}
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Cost</dt>
            <dd className="text-ink tnum">
              {l.cost ? (
                <>
                  <span className="font-semibold">{money(l.cost)}</span> <span className="text-ink-3">{COST_KIND_LABEL[l.costKind ?? ''] ?? ''}</span>
                </>
              ) : (
                <Missing label="Not recorded" />
              )}
            </dd>
          </div>
          {l.bookingRef ? (
            <div className="flex gap-1.5">
              <dt className="text-ink-3">Booking</dt>
              <dd className="font-mono text-[12.5px] text-ink">{l.bookingRef}</dd>
            </div>
          ) : null}
          {l.bookingUrl ? (
            <div className="flex gap-1.5">
              <dt className="sr-only">Link</dt>
              <dd>
                <a href={l.bookingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
                  {host(l.bookingUrl)} <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
        {l.notes ? <p className="mt-2 max-w-[64ch] text-[13px] text-ink-2">{l.notes}</p> : null}
      </div>
      <div className="col-start-2 mt-2 md:col-start-3 md:row-start-1 md:mt-0">
        {l.tripId ? (
          <Link href={`${tripHref(l.tripId)}#learning`} className="inline-flex h-11 items-center gap-1 rounded-md text-[13px] font-medium text-teal hover:underline md:h-8">
            In {l.tripName ?? 'a trip'} <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : (
          <Button size="sm" variant="secondary" className="h-11 md:h-8" onClick={(e) => onEdit(l, e.currentTarget)} aria-label={`Edit ${title} at ${l.resortName}`}>
            <PencilLine aria-hidden className="size-4" /> Edit
          </Button>
        )}
      </div>
    </Rise>
  )
}

function Group({ title, lessons, demo, onEdit, empty }: { title: string; lessons: LessonView[]; demo: boolean; onEdit: (l: LessonView, from: HTMLElement) => void; empty?: string }) {
  if (!lessons.length && !empty) return null
  const id = `lessons-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-2 text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {title} <span className="font-normal tracking-normal text-ink-3 normal-case tnum">· {lessons.length}</span>
      </h3>
      {lessons.length ? (
        <ol className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
          {lessons.map((l, k) => (
            <LessonRow key={l.id} l={l} index={k} demo={demo} onEdit={onEdit} />
          ))}
        </ol>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-3 text-[13.5px] text-ink-2">{empty}</p>
      )}
    </section>
  )
}

export function Lessons({ lessons, resorts, skills, currency, demo }: { lessons: SeasonView['lessons']; resorts: PickerResort[]; skills: ChecklistSkill[]; currency: string; demo: boolean }) {
  const [sheet, setSheet] = useState<{ open: boolean; lesson: LessonView | null; seq: number }>({ open: false, lesson: null, seq: 0 })
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const open = (lesson: LessonView | null, from: HTMLElement) => {
    setOpener(from)
    setSheet((s) => ({ open: true, lesson, seq: s.seq + 1 }))
  }
  const any = lessons.upcoming.length + lessons.past.length + lessons.undated.length > 0
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[13.5px] text-ink-2">Focus skills come from your checklist. A lesson never changes a skill’s status — update it yourself after the lesson, or note what the instructor confirmed.</p>
        <Button variant="secondary" className="h-11 md:h-10" onClick={(e) => open(null, e.currentTarget)}>
          <Plus aria-hidden className="size-4" /> Plan a lesson
        </Button>
      </div>
      {any ? (
        <>
          <Group title="Coming up" lessons={lessons.upcoming} demo={demo} onEdit={open} empty="No lessons planned yet." />
          <Group title="Not scheduled" lessons={lessons.undated} demo={demo} onEdit={open} />
          <Group title="Past" lessons={lessons.past} demo={demo} onEdit={open} />
        </>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-4 text-[13.5px] text-ink-2">
          No lessons yet this season. Plan one here, or from a trip’s “Lessons &amp; rentals” section so it lands in the itinerary and budget.
        </p>
      )}
      <LessonSheet
        key={sheet.seq}
        open={sheet.open}
        onOpenChange={(v) => setSheet((s) => ({ ...s, open: v }))}
        onCloseAutoFocus={(e) => {
          if (opener && document.contains(opener)) {
            e.preventDefault()
            opener.focus()
          }
        }}
        lesson={sheet.lesson}
        resorts={resorts}
        skills={skills}
        currency={currency}
        demo={demo}
      />
    </div>
  )
}
