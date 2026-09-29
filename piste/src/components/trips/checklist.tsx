'use client'
/**
 * Trip checklist: gear, bookings, travel, on-the-day. Check items off (saved immediately), add your own, remove with
 * Undo, top up from your templates, and edit the templates themselves (they seed every new trip).
 */
import { useId, useOptimistic, useState, useTransition } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, ListRestart, Plus, Settings2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Field, Select, TextInput } from '@/components/ui/form'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import {
  addChecklistItem,
  applyChecklistTemplates,
  removeChecklistItem,
  removeChecklistTemplate,
  restoreChecklistItem,
  restoreChecklistTemplate,
  saveChecklistTemplate,
  updateChecklistItem,
} from '@/lib/actions/trips'
import { useTripUi } from './trip-ui'

export interface ChecklistRow {
  id: number
  label: string
  category: string | null
  done: boolean
  link: string | null
  sortOrder: number
}

type Op = { kind: 'toggle'; id: number; done: boolean } | { kind: 'remove'; id: number } | { kind: 'add'; row: ChecklistRow }

const DEFAULT_CATEGORIES = ['Gear', 'Bookings', 'Travel', 'On the day']

export function Checklist({ items, templates }: { items: ChecklistRow[]; templates: { id: number; label: string; category: string | null; sortOrder: number }[] }) {
  const { data, run, pending } = useTripUi()
  const toast = useToast()
  const [, start] = useTransition()
  const [list, apply] = useOptimistic(items, (state: ChecklistRow[], op: Op) =>
    op.kind === 'toggle' ? state.map((r) => (r.id === op.id ? { ...r, done: op.done } : r)) : op.kind === 'remove' ? state.filter((r) => r.id !== op.id) : [...state, op.row],
  )
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('')
  const [tplOpen, setTplOpen] = useState(false)
  const uid = useId()
  const done = list.filter((r) => r.done).length
  const categories = [...new Set([...list.map((r) => r.category ?? 'Other'), ...DEFAULT_CATEGORIES])]
  const groups = [...new Set(list.map((r) => r.category ?? 'Other'))].map((c) => ({ c, rows: list.filter((r) => (r.category ?? 'Other') === c) }))

  const toggle = (r: ChecklistRow, next: boolean) =>
    start(async () => {
      apply({ kind: 'toggle', id: r.id, done: next })
      const res = await updateChecklistItem({ tripId: data.tripId, id: r.id, done: next })
      if (!res.ok) toast.show(res.error, { tone: 'error' })
    })
  const remove = (r: ChecklistRow) =>
    start(async () => {
      apply({ kind: 'remove', id: r.id })
      const res = await removeChecklistItem({ tripId: data.tripId, id: r.id })
      if (!res.ok) toast.show(res.error, { tone: 'error' })
      else toast.show(`Removed “${r.label}”`, { undo: async () => void (await restoreChecklistItem({ snapshot: res.data.snapshot })) })
    })
  const add = () => {
    const text = label.trim()
    if (!text) return
    const cat = category || null
    setLabel('')
    start(async () => {
      apply({ kind: 'add', row: { id: -Date.now(), label: text, category: cat, done: false, link: null, sortOrder: 1e6 } })
      const res = await addChecklistItem({ tripId: data.tripId, label: text, category: cat })
      if (!res.ok) toast.show(res.error, { tone: 'error' })
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[200px] flex-1">
          <p className="text-[14px] text-ink-2">
            <span className="font-semibold text-ink tnum">{done}</span> of <span className="tnum">{list.length}</span> done
          </p>
          <div aria-hidden className="mt-1.5 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full rounded-full bg-teal" initial={{ width: 0 }} animate={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} transition={t.bars} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => run(() => applyChecklistTemplates({ tripId: data.tripId }))}>
            <ListRestart aria-hidden className="size-4" /> Add from templates
          </Button>
          <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setTplOpen(true)}>
            <Settings2 aria-hidden className="size-4" /> Edit templates
          </Button>
        </div>
      </div>

      {groups.length ? (
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.c} className="min-w-0">
              <legend className="eyebrow mb-1.5">{g.c}</legend>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <li key={r.id} className="group/ck flex min-h-11 items-center gap-2 border-b border-divider last:border-0">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                      <input type="checkbox" checked={r.done} disabled={r.id < 0} onChange={(e) => toggle(r, e.target.checked)} className="size-5 shrink-0 accent-[var(--teal)]" />
                      <span className={cn('text-[14.5px] transition-colors duration-150', r.done ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink')}>{r.label}</span>
                    </label>
                    {r.link ? (
                      <a href={r.link} target="_blank" rel="noopener noreferrer" aria-label={`Open link for ${r.label} (new tab)`} className="inline-flex size-9 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-teal">
                        <ExternalLink aria-hidden className="size-4" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove “${r.label}”`}
                      disabled={r.id < 0}
                      onClick={() => remove(r)}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-critical md:opacity-0 md:group-hover/ck:opacity-100 md:focus-visible:opacity-100"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong px-4 py-3 text-[13.5px] text-ink-2">The checklist is empty. Add from your templates or write your own below.</p>
      )}

      <form
        className="flex flex-col gap-2 rounded-[12px] border border-divider bg-surface-2 p-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Field label="Add an item" htmlFor={`${uid}-l`} className="min-w-0 flex-1">
          <TextInput id={`${uid}-l`} value={label} maxLength={200} placeholder="e.g. Pack tire chains" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Group" htmlFor={`${uid}-c`} className="sm:w-[168px]">
          <Select id={`${uid}-c`} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Other</option>
            {categories
              .filter((c) => c !== 'Other')
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" className="h-11 md:h-10" disabled={!label.trim()}>
          <Plus aria-hidden className="size-4" /> Add
        </Button>
      </form>

      <TemplatesSheet open={tplOpen} onOpenChange={setTplOpen} templates={templates} />
    </div>
  )
}

function TemplatesSheet({ open, onOpenChange, templates }: { open: boolean; onOpenChange: (o: boolean) => void; templates: { id: number; label: string; category: string | null }[] }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('Gear')
  const uid = useId()
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...templates.map((t) => t.category ?? 'Other')])]
  const call = <T,>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string }>, then?: (d: T) => void) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) toast.show(r.error, { tone: 'error' })
      else then?.(r.data)
    })
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Checklist templates" description="New trips start with these. Changes here don’t alter existing trips — use “Add from templates” to top one up.">
      <ul className="flex flex-col divide-y divide-divider">
        {templates.map((tpl) => (
          <li key={tpl.id} className="flex items-center gap-2 py-2">
            <TextInput
              aria-label={`Template: ${tpl.label}`}
              defaultValue={tpl.label}
              maxLength={200}
              className="h-10 flex-1"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== tpl.label) call(() => saveChecklistTemplate({ id: tpl.id, label: v, category: tpl.category }), () => toast.show('Template saved'))
              }}
            />
            <span className="hidden w-[92px] shrink-0 truncate text-[12.5px] text-ink-3 sm:inline">{tpl.category ?? 'Other'}</span>
            <button
              type="button"
              aria-label={`Remove template “${tpl.label}”`}
              disabled={pending}
              onClick={() =>
                call(
                  () => removeChecklistTemplate({ id: tpl.id }),
                  (d) => toast.show(`Removed “${tpl.label}” from templates`, { undo: async () => void (await restoreChecklistTemplate({ snapshot: d.snapshot })) }),
                )
              }
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-critical"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-col gap-3 rounded-[12px] border border-divider bg-surface-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          const v = label.trim()
          if (!v) return
          call(() => saveChecklistTemplate({ label: v, category }), () => {
            setLabel('')
            toast.show('Template added')
          })
        }}
      >
        <Field label="New template item" htmlFor={`${uid}-n`}>
          <TextInput id={`${uid}-n`} value={label} maxLength={200} placeholder="e.g. Charge headlamp" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Group" htmlFor={`${uid}-g`}>
          <Select id={`${uid}-g`} value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" className="h-11 self-start md:h-10" disabled={!label.trim() || pending}>
          <Plus aria-hidden className="size-4" /> Add template
        </Button>
      </form>
    </Sheet>
  )
}
