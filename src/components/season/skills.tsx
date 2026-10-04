'use client'
/**
 * Learning checklist. Each skill's status is what I say — not started, practising, confirmed by me — or what an
 * instructor confirmed (with the date and an optional note). Practice counts come from my ski-day journal; nothing
 * here infers ability from spending or distance travelled. "Edit list" switches the rows to rename / reorder /
 * remove (with Undo); new skills can be added at any time.
 */
import { useId, useState, useTransition, type ReactNode } from 'react'
import { BadgeCheck, ChevronDown, ChevronRight, ChevronUp, Circle, CircleCheck, CircleDashed, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Button, IconButton } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { Sheet } from '@/components/ui/sheet'
import { Notice } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { addSkill, moveSkill, removeSkill, renameSkill, restoreSkill, setSkillStatus } from '@/lib/actions/season'
import type { ChecklistSkill } from '@/lib/data/season-screen'
import { formatLocalDate } from '@/lib/domain/time'
import { plural } from './format'
import { useSeasonUi } from './season-ui'
import { useDateMarks } from './date-marks'

type Status = ChecklistSkill['status']

export const STATUS_META: Record<Status, { label: string; Icon: LucideIcon; cls: string; narrow: string; rail: string; blurb: string }> = {
  'not-started': { label: 'Not started', Icon: Circle, cls: 'text-ink-3', narrow: 'max-sm:text-ink-3', rail: 'bg-surface-3', blurb: 'Not worked on yet.' },
  practicing: {
    label: 'Practising',
    Icon: CircleDashed,
    cls: 'text-ink-2',
    narrow: 'max-sm:text-ink-2',
    rail: 'bg-[repeating-linear-gradient(135deg,var(--teal)_0_2px,transparent_2px_5px)] opacity-70',
    blurb: 'Working on it.',
  },
  'self-confirmed': { label: 'Confirmed by you', Icon: CircleCheck, cls: 'text-teal', narrow: 'max-sm:text-teal', rail: 'bg-teal', blurb: 'You can do it reliably — your own judgement.' },
  'instructor-confirmed': { label: 'Confirmed by an instructor', Icon: BadgeCheck, cls: 'text-positive', narrow: 'max-sm:text-positive', rail: 'bg-positive', blurb: 'An instructor saw you do it.' },
}
const ORDER: Status[] = ['not-started', 'practicing', 'self-confirmed', 'instructor-confirmed']
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function StatusPill({ status, onClick, label }: { status: Status; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; label: string }) {
  const m = STATUS_META[status]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${m.label}. Change status`}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 md:h-8',
        status === 'instructor-confirmed' && 'border-positive/40 bg-positive-bg text-positive hover:border-positive',
        status === 'self-confirmed' && 'border-teal/40 bg-glacier text-teal hover:border-teal',
        status === 'practicing' && 'border-divider-strong bg-surface text-ink hover:border-teal',
        status === 'not-started' && 'border-dashed border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink',
      )}
    >
      <m.Icon aria-hidden className="size-4" />
      {m.label}
    </button>
  )
}

function StatusSheet({ skill, today, open, onOpenChange, onCloseAutoFocus }: { skill: ChecklistSkill | null; today: string; open: boolean; onOpenChange: (v: boolean) => void; onCloseAutoFocus?: (e: Event) => void }) {
  const toast = useToast()
  const { celebrate } = useSeasonUi()
  const formId = useId()
  const name = useId()
  const ids = { date: useId(), note: useId() }
  const marks = useDateMarks()
  const [status, setStatus] = useState<Status>(skill?.status ?? 'not-started')
  const [date, setDate] = useState(skill?.confirmedOn ?? today)
  const [note, setNote] = useState(skill?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!skill) return null
  const confirmed = status === 'self-confirmed' || status === 'instructor-confirmed'
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={skill.label}
      description="Your progress, in your words — or an instructor's. Piste never works this out from what you spend or how far you travel."
      footer={
        <div className="flex justify-end">
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="h-11 md:h-10">
            {pending ? 'Saving…' : 'Save progress'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            setError(null)
            setErrors({})
            const r = await setSkillStatus({ id: skill.id, status, confirmedOn: confirmed ? date : null, notes: note })
            if (!r.ok) {
              setError(r.error)
              setErrors(r.fieldErrors ?? {})
              return
            }
            onOpenChange(false)
            const prev = r.data.previous
            if (confirmed && prev.status !== 'self-confirmed' && prev.status !== 'instructor-confirmed') celebrate('Skill confirmed')
            toast.show(r.message ?? 'Saved', {
              undo: async () => {
                const back = await setSkillStatus({ id: skill.id, status: prev.status, confirmedOn: prev.confirmedOn, notes: prev.notes })
                if (!back.ok) toast.show(back.error, { tone: 'error' })
              },
            })
          })
        }}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        <fieldset>
          <legend className="text-[13.5px] font-medium text-ink">Status</legend>
          <div className="mt-2 flex flex-col gap-2">
            {ORDER.map((s) => {
              const m = STATUS_META[s]
              const on = status === s
              return (
                <label
                  key={s}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                    on ? 'border-teal bg-glacier/60' : 'border-divider hover:border-divider-strong',
                  )}
                >
                  <input type="radio" name={name} value={s} checked={on} onChange={() => setStatus(s)} className="sr-only" />
                  <m.Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', m.cls)} />
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-medium text-ink">{m.label}</span>
                    <span className="block text-[12.5px] text-ink-3">{m.blurb}</span>
                  </span>
                  <span aria-hidden className={cn('ml-auto mt-1 size-4 shrink-0 rounded-full border-2', on ? 'border-teal bg-teal shadow-[inset_0_0_0_2px_var(--surface)]' : 'border-divider-strong')} />
                </label>
              )
            })}
          </div>
        </fieldset>
        {confirmed ? (
          <Field label={status === 'instructor-confirmed' ? 'Confirmed on' : 'Since'} htmlFor={ids.date} error={errors.confirmedOn}>
            <DatePicker id={ids.date} value={date} max={today} today={today} marks={marks} presets={['today']} onChange={setDate} className="sm:max-w-[16rem]" aria-invalid={!!errors.confirmedOn} />
          </Field>
        ) : null}
        <Field
          label={status === 'instructor-confirmed' ? 'Instructor’s note' : 'Note'}
          htmlFor={ids.note}
          optional
          error={errors.notes}
          hint={status === 'instructor-confirmed' ? 'e.g. who confirmed it, in which lesson, what to work on next' : undefined}
        >
          <Textarea id={ids.note} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

function Meta({ k }: { k: ChecklistSkill }) {
  const bits = [
    k.practicedDays ? `Practised on ${plural(k.practicedDays, 'day')}${k.lastPracticed ? ` · last ${formatLocalDate(k.lastPracticed, 'd LLL')}` : ''}` : null,
    k.lessons ? `focus of ${plural(k.lessons, 'lesson')}` : null,
  ].filter(Boolean)
  return bits.length ? <p className="mt-0.5 text-[12.5px] text-ink-3 tnum">{bits.join(' · ')}</p> : null
}

function RenameRow({ k, categories, first, last, busy, run }: { k: ChecklistSkill; categories: string[]; first: boolean; last: boolean; busy: boolean; run: (fn: () => Promise<void>) => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(k.label)
  const [err, setErr] = useState<string | null>(null)
  const id = useId()
  const commit = (category?: string | null) =>
    run(async () => {
      const next = label.trim()
      if (!next) {
        setErr('Name the skill')
        return
      }
      if (next === k.label && category === undefined) return
      const r = await renameSkill({ id: k.id, label: next, ...(category !== undefined ? { category } : {}) })
      if (!r.ok) setErr(r.fieldErrors?.label ?? r.error)
      else setErr(null)
    })
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          Skill name
        </label>
        <TextInput
          id={id}
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          aria-invalid={!!err}
        />
        {err ? (
          <p role="alert" className="mt-1 text-[12.5px] font-medium text-critical">
            {err}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <label className="sr-only" htmlFor={`${id}-cat`}>
          Category
        </label>
        <Select id={`${id}-cat`} value={k.category ?? ''} onChange={(e) => commit(e.target.value || null)} className="w-[9.5rem] text-[14px]">
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <IconButton label={`Move “${k.label}” up`} size="lg" className="disabled:pointer-events-none disabled:opacity-35 md:size-10" disabled={first || busy} onClick={() => run(async () => void (await moveSkill({ id: k.id, direction: 'up' })))}>
          <ChevronUp aria-hidden className="size-4" />
        </IconButton>
        <IconButton label={`Move “${k.label}” down`} size="lg" className="disabled:pointer-events-none disabled:opacity-35 md:size-10" disabled={last || busy} onClick={() => run(async () => void (await moveSkill({ id: k.id, direction: 'down' })))}>
          <ChevronDown aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={`Remove “${k.label}”`}
          size="lg"
          className="hover:bg-critical-bg hover:text-critical disabled:opacity-35 md:size-10"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await removeSkill({ id: k.id })
              if (!r.ok) {
                toast.show(r.error, { tone: 'error' })
                return
              }
              const snapshot = r.data.snapshot
              toast.show(r.message ?? 'Removed', {
                undo: async () => {
                  const back = await restoreSkill({ snapshot })
                  if (!back.ok) toast.show(back.error, { tone: 'error' })
                },
              })
            })
          }
        >
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}

function AddSkill({ categories }: { categories: string[] }) {
  const toast = useToast()
  const ids = { label: useId(), cat: useId(), newCat: useId() }
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(categories[categories.length - 1] ?? '')
  const [newCat, setNewCat] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const NEW = '__new__'
  return (
    <form
      className="flex flex-col gap-3 border-t border-divider bg-surface-2 px-4 py-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await addSkill({ label, category: category === NEW ? newCat : category || null })
          if (!r.ok) {
            setErr(r.fieldErrors?.label ?? r.fieldErrors?.category ?? r.error)
            return
          }
          setErr(null)
          setLabel('')
          toast.show(r.message ?? 'Added')
        })
      }}
    >
      <Field label="Add a skill" htmlFor={ids.label} error={err} className="min-w-0 flex-1">
        <TextInput id={ids.label} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Hockey stop" aria-invalid={!!err} />
      </Field>
      <Field label="Category" htmlFor={ids.cat} className="sm:w-[11rem]">
        <Select id={ids.cat} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={NEW}>New category…</option>
        </Select>
      </Field>
      {category === NEW ? (
        <Field label="New category" htmlFor={ids.newCat} className="sm:w-[10rem]">
          <TextInput id={ids.newCat} value={newCat} maxLength={40} onChange={(e) => setNewCat(e.target.value)} />
        </Field>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending || !label.trim()} className="h-11 md:h-10">
        <Plus aria-hidden className="size-4" /> {pending ? 'Adding…' : 'Add skill'}
      </Button>
    </form>
  )
}

function Summary({ skills, note }: { skills: ChecklistSkill[]; note: string }) {
  const count = (s: Status) => skills.filter((k) => k.status === s).length
  const confirmed = count('self-confirmed') + count('instructor-confirmed')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 lg:flex-col lg:items-start lg:gap-y-3">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-[40px] leading-none text-ink tnum">{confirmed}</span>
          <span className="text-[14px] text-ink-2">of {plural(skills.length, 'skill')} confirmed</span>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2 lg:flex-col lg:gap-y-1.5">
          {(['instructor-confirmed', 'self-confirmed', 'practicing', 'not-started'] as Status[]).map((s) => {
            const m = STATUS_META[s]
            return (
              <li key={s} className="inline-flex items-center gap-1.5 tnum">
                <m.Icon aria-hidden className={cn('size-4', m.cls)} />
                {count(s)} {m.label.charAt(0).toLowerCase() + m.label.slice(1)}
              </li>
            )
          })}
        </ul>
      </div>
      <div aria-hidden className="flex h-3 gap-[3px]">
        {skills.map((k) => (
          <span key={k.id} title={`${k.label}: ${STATUS_META[k.status].label}`} className={cn('h-full min-w-1 flex-1 rounded-[3px]', STATUS_META[k.status].rail)} />
        ))}
      </div>
      <p className="text-[12.5px] text-ink-3">{note}</p>
    </div>
  )
}

export function Skills({ skills, categories, today, note }: { skills: ChecklistSkill[]; categories: string[]; today: string; note: string }) {
  const [editing, setEditing] = useState(false)
  const [busy, startBusy] = useTransition()
  const [sheet, setSheet] = useState<{ id: number | null; open: boolean; seq: number }>({ id: null, open: false, seq: 0 })
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const run = (fn: () => Promise<void>) => startBusy(fn)
  const groups: [string, ChecklistSkill[]][] = []
  for (const k of skills) {
    const c = k.category ?? 'Other'
    const g = groups.find(([name]) => name === c)
    if (g) g[1].push(k)
    else groups.push([c, [k]])
  }
  const current = skills.find((k) => k.id === sheet.id) ?? null

  let body: ReactNode
  if (!skills.length) {
    body = <p className="px-4 py-5 text-[13.5px] text-ink-2">Your checklist is empty. Add the skills you want to learn — for example stopping, turning, linking turns and riding lifts.</p>
  } else {
    body = groups.map(([cat, list]) => (
      <section key={cat} aria-labelledby={`skill-cat-${slug(cat)}`} className="border-t border-divider first:border-t-0">
        <h3 id={`skill-cat-${slug(cat)}`} className="flex items-baseline gap-2 bg-surface-2 px-4 py-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
          {cat}
          <span className="font-normal tracking-normal text-ink-3 normal-case tnum">· {list.filter((k) => k.status === 'self-confirmed' || k.status === 'instructor-confirmed').length} of {list.length} confirmed</span>
        </h3>
        <ol className="divide-y divide-divider">
          {list.map((k, i) =>
            editing ? (
              <li key={k.id}>
                <RenameRow k={k} categories={categories} first={i === 0} last={i === list.length - 1} busy={busy} run={run} />
              </li>
            ) : (
              <li key={k.id} className="relative flex items-start gap-3 px-4 py-3 sm:gap-4">
                {(() => {
                  const M = STATUS_META[k.status]
                  return <M.Icon aria-hidden className={cn('mt-px size-5 shrink-0', M.cls)} />
                })()}
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium text-ink">{k.label}</p>
                  {(() => {
                    const M = STATUS_META[k.status]
                    const confirmed = !!k.confirmedOn && (k.status === 'self-confirmed' || k.status === 'instructor-confirmed')
                    return (
                      <p className={cn('mt-0.5 text-[12.5px] tnum max-sm:font-medium', confirmed ? 'text-ink-2' : 'sm:hidden', M.narrow)}>
                        <span className="sm:hidden">{M.label}</span>
                        {confirmed ? (
                          <>
                            <span className="sm:hidden"> · </span>
                            <span className="hidden sm:inline">{k.status === 'instructor-confirmed' ? 'Instructor confirmed ' : 'Confirmed by you '}</span>
                            {formatLocalDate(k.confirmedOn!, 'd LLL yyyy')}
                          </>
                        ) : null}
                      </p>
                    )
                  })()}
                  <Meta k={k} />
                  {k.notes ? <p className="mt-1 max-w-[62ch] text-[13px] text-ink-2 italic">“{k.notes}”</p> : null}
                </div>
                <div className="hidden shrink-0 sm:-my-[5px] sm:block">
                  <StatusPill
                    status={k.status}
                    label={k.label}
                    onClick={(e) => {
                      setOpener(e.currentTarget)
                      setSheet((s) => ({ id: k.id, open: true, seq: s.seq + 1 }))
                    }}
                  />
                </div>
                {/* Narrow screens: the whole row opens the status sheet. */}
                <button
                  type="button"
                  aria-label={`${k.label}: ${STATUS_META[k.status].label}. Change status`}
                  onClick={(e) => {
                    setOpener(e.currentTarget)
                    setSheet((s) => ({ id: k.id, open: true, seq: s.seq + 1 }))
                  }}
                  className="absolute inset-0 rounded-none active:bg-surface-3/50 sm:hidden"
                />
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3 sm:hidden" />
              </li>
            ),
          )}
        </ol>
      </section>
    ))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)] xl:gap-8">
      <div className="lg:sticky lg:top-[84px] lg:self-start">
        <Summary skills={skills} note={note} />
      </div>
      <div className="min-w-0 overflow-hidden rounded-[12px] border border-divider bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-2.5">
          <p className="text-[13px] text-ink-2">{editing ? 'Rename, reorder within a category, or remove. Changes save as you go.' : 'Tap a status to update it.'}</p>
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} className="h-11 md:h-8" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? 'Done' : 'Edit list'}
          </Button>
        </div>
        {body}
        <AddSkill categories={categories} />
      </div>
      <StatusSheet
        key={sheet.seq}
        skill={current}
        today={today}
        open={sheet.open}
        onOpenChange={(v) => setSheet((s) => ({ ...s, open: v }))}
        onCloseAutoFocus={(e) => {
          if (opener && document.contains(opener)) {
            e.preventDefault()
            opener.focus()
          }
        }}
      />
    </div>
  )
}
