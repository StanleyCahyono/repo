'use client'
/**
 * Spending: actual vs planned by category from the season-budget engine, and the expenses that make up "actual".
 *
 * - The pass purchase is counted once (the expense linked to the pass, or the price paid on the pass record); days
 *   skied on the pass add no lift cash. Planned = my share of priced items on non-cancelled trips.
 * - The category rows are a real table; the bars beside the numbers are decoration (actual solid, planned as an
 *   outlined track), so nothing is colour-only. Bars reveal once.
 * - Pass purchases linked to a pass record are managed in Passes & Costs; everything else can be added, edited and
 *   removed here (with Undo).
 */
import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowRight, CircleAlert, Info, PencilLine, Plus, Receipt, Trash2 } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { KindTag } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { Sheet } from '@/components/ui/sheet'
import { Notice } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { deleteExpense, restoreExpense, saveExpense } from '@/lib/actions/season'
import type { SeasonView } from '@/lib/data/season'
import type { ExpenseItem, PickerTrip } from '@/lib/data/season-screen'
import { BUDGET_CATEGORIES, normalizeCategory, type BudgetCategory } from '@/lib/domain/costs'
import { formatMoneyRange, money as mk, type Money } from '@/lib/domain/money'
import { formatLocalDate } from '@/lib/domain/time'
import { CATEGORY_LABEL, budgetProvenance, currencies, majorString, money, plural, rangeLabel, tripHref } from './format'

/** Actual so far against the season's plan (which includes trips still to come). */
function signed(m: Money): string {
  const abs = money(mk(Math.abs(m.amountMinor), m.currency)) ?? ''
  if (m.amountMinor === 0) return 'on plan'
  return m.amountMinor > 0 ? `${abs} over plan` : `${abs} left in plan`
}

function CategoryTable({ budget }: { budget: SeasonView['budget'] }) {
  const rows = budget.categories.filter((c) => c.actual.amountMinor > 0 || c.planned.amountMinor > 0 || c.plannedMax.amountMinor > 0)
  const top = Math.max(1, ...rows.map((r) => Math.max(r.actual.amountMinor, r.plannedMax.amountMinor)))
  const w = (m: Money) => `${Math.min(100, (m.amountMinor / top) * 100)}%`
  if (!rows.length) return <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-4 text-[13.5px] text-ink-2">Nothing spent or planned yet this season.</p>
  return (
    <div className="overflow-hidden rounded-[12px] border border-divider bg-surface">
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Spending by category: actual so far and planned, in {budget.currency}</caption>
        <thead>
          <tr className="border-b border-divider text-left text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Category
            </th>
            <th scope="col" className="hidden px-2 py-2.5 font-semibold lg:table-cell">
              <span className="sr-only">Actual against planned</span>
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-semibold">
              Actual
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-semibold">
              Planned
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold sm:table-cell">
              Against plan
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((r, k) => {
            const range = formatMoneyRange(r.planned, r.plannedMax)
            return (
              <tr key={r.category}>
                <th scope="row" className="px-4 py-3 text-left align-top font-medium text-ink lg:align-middle">
                  {CATEGORY_LABEL[r.category]}
                  {r.category === 'pass' ? <span className="block text-[12px] font-normal text-ink-3">counted once</span> : null}
                  {/* Narrow screens: the bar sits under the label. */}
                  <span aria-hidden className="relative mt-2 block h-2 w-full overflow-hidden rounded-full bg-surface-3 lg:hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full border border-teal/50" style={{ width: w(r.plannedMax) }} />
                    <motion.span className="absolute inset-y-0 left-0 rounded-full bg-teal" style={{ width: w(r.actual), originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...t.bars, delay: 0.04 * k }} />
                  </span>
                </th>
                <td aria-hidden className="hidden w-[34%] px-2 py-3 align-middle lg:table-cell">
                  <div className="relative h-2.5 w-full rounded-full bg-surface-3">
                    <div className="absolute inset-y-0 left-0 rounded-full border border-teal/50 bg-[repeating-linear-gradient(135deg,var(--divider)_0_1px,transparent_1px_5px)]" style={{ width: w(r.plannedMax) }} />
                    <motion.div className="absolute inset-y-0 left-0 rounded-full bg-teal" style={{ width: w(r.actual), originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...t.bars, delay: 0.04 * k }} />
                  </div>
                </td>
                <td className="px-2 py-3 text-right align-top font-semibold whitespace-nowrap text-ink tnum lg:align-middle">{r.actual.amountMinor ? money(r.actual) : <span className="font-normal text-ink-3">—</span>}</td>
                <td className="px-2 py-3 text-right align-top whitespace-nowrap text-ink-2 tnum lg:align-middle">{r.planned.amountMinor || r.plannedMax.amountMinor ? range : <span className="text-ink-3">—</span>}</td>
                <td className="hidden px-4 py-3 text-right align-top whitespace-nowrap text-ink-2 tnum sm:table-cell lg:align-middle">
                  {r.planned.amountMinor ? <span className={cn(r.variance.amountMinor > 0 && 'font-medium text-caution')}>{signed(r.variance)}</span> : <span className="text-ink-3">not planned</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-divider-strong bg-surface-2">
            <th scope="row" className="px-4 py-3 text-left font-semibold text-ink">
              Total
            </th>
            <td aria-hidden className="hidden lg:table-cell" />
            <td className="px-2 py-3 text-right font-semibold whitespace-nowrap text-ink tnum">{money(budget.actualTotal)}</td>
            <td className="px-2 py-3 text-right font-medium whitespace-nowrap text-ink-2 tnum">{formatMoneyRange(budget.plannedTotal, budget.plannedTotalMax)}</td>
            <td className="hidden px-4 py-3 text-right whitespace-nowrap text-ink-2 tnum sm:table-cell">{budget.plannedTotal.amountMinor ? signed({ ...budget.actualTotal, amountMinor: budget.actualTotal.amountMinor - budget.plannedTotal.amountMinor }) : ''}</td>
          </tr>
        </tfoot>
      </table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider px-4 py-2 text-[12.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-full bg-teal" /> Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-full border border-teal/50 bg-surface-3" /> Planned (up to the high end of estimates)
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expenses

interface ExpenseForm {
  date: string
  label: string
  category: BudgetCategory
  amount: string
  currency: string
  tripId: string
  notes: string
}

function ExpenseSheet({
  open,
  onOpenChange,
  expense,
  trips,
  currency,
  today,
  demo,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCloseAutoFocus?: (e: Event) => void
  expense: ExpenseItem | null
  trips: PickerTrip[]
  currency: string
  today: string
  demo: boolean
}) {
  const toast = useToast()
  const formId = useId()
  const ids = { date: useId(), label: useId(), cat: useId(), amount: useId(), cur: useId(), trip: useId(), notes: useId() }
  const [f, setF] = useState<ExpenseForm>(() =>
    expense
      ? { date: expense.date, label: expense.label, category: normalizeCategory(expense.category), amount: majorString(expense.amount), currency: expense.amount.currency, tripId: expense.tripId ?? '', notes: expense.notes ?? '' }
      : { date: today, label: '', category: 'lift', amount: '', currency, tripId: '', notes: '' },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof ExpenseForm>(k: K, v: ExpenseForm[K]) => setF((x) => ({ ...x, [k]: v }))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={expense ? 'Edit expense' : 'Add an expense'}
      description="Money you have spent this season. It counts in “actual” spending and cost per ski day."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-3">{demo ? 'Demo mode — saved to the demo database only.' : 'Private to you.'}</p>
          <Button type="submit" form={formId} variant="primary" disabled={pending} className="ml-auto h-11 md:h-10">
            {pending ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
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
            const r = await saveExpense({ id: expense?.id ?? null, date: f.date, label: f.label, category: f.category, amount: f.amount, currency: f.currency, tripId: f.tripId || null, notes: f.notes })
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
        <Field label="What for" htmlFor={ids.label} error={errors.label}>
          <TextInput id={ids.label} value={f.label} maxLength={120} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Lift ticket, Labrador" aria-invalid={!!errors.label} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor={ids.date} error={errors.date}>
            <TextInput id={ids.date} type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className="tnum" aria-invalid={!!errors.date} />
          </Field>
          <Field label="Category" htmlFor={ids.cat} error={errors.category} hint={f.category === 'pass' ? 'Add passes in Passes & Costs so their days count; an unlinked pass expense of the same price is still counted once.' : undefined}>
            <Select id={ids.cat} value={f.category} onChange={(e) => set('category', e.target.value as BudgetCategory)}>
              {BUDGET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-4">
          <Field label="Amount" htmlFor={ids.amount} error={errors.amount}>
            <TextInput id={ids.amount} inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="e.g. 59" className="tnum" aria-invalid={!!errors.amount} />
          </Field>
          <Field label="Currency" htmlFor={ids.cur} error={errors.currency}>
            <Select id={ids.cur} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
              {currencies(currency, f.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Trip" htmlFor={ids.trip} optional error={errors.tripId}>
          <Select id={ids.trip} value={f.tripId} onChange={(e) => set('tripId', e.target.value)}>
            <option value="">Not part of a trip</option>
            {trips.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name} · {rangeLabel(tr.startDate, tr.endDate)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor={ids.notes} optional error={errors.notes}>
          <Textarea id={ids.notes} rows={3} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}

function ExpenseRow({ e, onEdit, demo }: { e: ExpenseItem; onEdit: (e: ExpenseItem, from: HTMLElement) => void; demo: boolean }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const cat = normalizeCategory(e.passOwnershipId != null ? 'pass' : e.category)
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3">
      <span className="pt-0.5 text-[12.5px] font-medium text-ink-2 tnum">{formatLocalDate(e.date, 'd LLL')}</span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">{e.label}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-3">
          <span>{CATEGORY_LABEL[cat]}</span>
          {e.passOwnershipId != null ? <span>· {e.passName ?? 'pass'} purchase, counted once</span> : null}
          {e.tripId && e.tripName ? (
            <>
              <span aria-hidden>·</span>
              <Link href={tripHref(e.tripId)} className="font-medium text-teal hover:underline">
                {e.tripName}
              </Link>
            </>
          ) : null}
          {demo ? <KindTag kind="demo" /> : null}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 md:flex-row md:items-center md:gap-2">
        <span className="text-[14px] font-semibold text-ink tnum">{money(e.amount)}</span>
        {e.passOwnershipId != null ? (
          <Link href="/passes" className="inline-flex h-8 items-center gap-1 text-[12.5px] font-medium text-teal hover:underline">
            In Passes <ArrowRight aria-hidden className="size-3" />
          </Link>
        ) : (
          <div className="flex items-center">
            <button
              type="button"
              onClick={(ev) => onEdit(e, ev.currentTarget)}
              className="inline-flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 hover:text-ink md:size-8"
              aria-label={`Edit ${e.label}`}
              title="Edit"
            >
              <PencilLine aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteExpense({ id: e.id })
                  if (!r.ok) {
                    toast.show(r.error, { tone: 'error' })
                    return
                  }
                  const snapshot = r.data.snapshot
                  toast.show(r.message ?? 'Removed', {
                    undo: async () => {
                      const back = await restoreExpense({ snapshot })
                      toast.show(back.ok ? 'Expense restored' : back.error, { tone: back.ok ? 'success' : 'error' })
                    },
                  })
                })
              }
              className="inline-flex size-11 items-center justify-center rounded-md text-ink-2 hover:bg-critical-bg hover:text-critical md:size-8"
              aria-label={`Remove ${e.label}`}
              title="Remove"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

const FIRST = 6

export function Spending({ view, expenses, trips, currency, today, demo }: { view: SeasonView; expenses: ExpenseItem[]; trips: PickerTrip[]; currency: string; today: string; demo: boolean }) {
  const b = view.budget
  const [sheet, setSheet] = useState<{ open: boolean; expense: ExpenseItem | null; seq: number }>({ open: false, expense: null, seq: 0 })
  const [all, setAll] = useState(false)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const open = (expense: ExpenseItem | null, from: HTMLElement) => {
    setOpener(from)
    setSheet((s) => ({ open: true, expense, seq: s.seq + 1 }))
  }
  const notes = [...b.warnings, ...view.budgetNotes]
  const shown = all ? expenses : expenses.slice(0, FIRST)

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4 xl:grid-cols-2">
          <div>
            <dt className="eyebrow flex h-4 items-center gap-1">
              Actual
              <SourceDrawer className="-my-1" title="How spending is counted" items={[{ label: 'Actual spending', value: expenses.length ? money(b.actualTotal) : 'Nothing recorded', prov: budgetProvenance(view.season.label) }]} />
            </dt>
            {expenses.length ? (
              <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{money(b.actualTotal)}</dd>
            ) : (
              <dd className="mt-1 font-display text-[24px] leading-none text-ink-3">None yet</dd>
            )}
          </div>
          <div>
            <dt className="eyebrow flex h-4 items-center">Planned</dt>
            <dd className="mt-1 font-display text-[28px] leading-none whitespace-nowrap text-ink-2 tnum">{b.plannedTotal.amountMinor || b.plannedTotalMax.amountMinor ? formatMoneyRange(b.plannedTotal, b.plannedTotalMax) : '—'}</dd>
          </div>
          <div>
            <dt className="eyebrow flex h-4 items-center">Season budget</dt>
            {b.seasonBudget ? (
              <>
                <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{money(b.seasonBudget)}</dd>
                {b.remainingBudget ? <dd className={cn('mt-1 text-[12.5px] tnum', b.remainingBudget.amountMinor < 0 ? 'font-medium text-caution' : 'text-ink-3')}>{b.remainingBudget.amountMinor < 0 ? `${money(mk(-b.remainingBudget.amountMinor, b.remainingBudget.currency))} over` : `${money(b.remainingBudget)} left`}</dd> : null}
              </>
            ) : (
              <dd className="mt-1.5 text-[13px] text-ink-3">
                Not set ·{' '}
                <Link href="/settings" className="font-medium text-teal hover:underline">
                  Settings
                </Link>
              </dd>
            )}
          </div>
          <div>
            <dt className="eyebrow flex h-4 items-center">Per ski day</dt>
            <dd className="mt-1 font-display text-[28px] leading-none text-ink tnum">{b.costPerSkiDay ? money(b.costPerSkiDay) : '—'}</dd>
            <dd className="mt-1 text-[12.5px] text-ink-3 tnum">{b.onSnowCostPerSkiDay ? `${money(b.onSnowCostPerSkiDay)} on snow · ${plural(b.skiDays, 'day')}` : 'No ski days yet'}</dd>
          </div>
        </dl>
        <CategoryTable budget={b} />
        {notes.length || b.unconverted.length || b.fxUsed.length ? (
          <ul className="flex flex-col gap-2 text-[13px] text-ink-2">
            {b.unconverted.map((u, k) => (
              <li key={`u${k}`} className="flex gap-2">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
                <span>
                  “{u.label}” ({money(u.original)}) is left out — no exchange rate on file to convert it to {b.currency}.
                </span>
              </li>
            ))}
            {notes.map((n, k) => (
              <li key={`n${k}`} className="flex gap-2">
                {k < b.warnings.length ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" /> : <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />}
                <span>{n}</span>
              </li>
            ))}
            {b.fxUsed.length ? (
              <li className="flex gap-2">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span className="tnum">Converted at {b.fxUsed.map((f) => `1 ${f.from} = ${f.rate} ${f.to} (${f.rateDate})`).join('; ')}.</span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <section aria-labelledby="expenses-title" className="self-start rounded-[12px] border border-divider bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
          <h3 id="expenses-title" className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Receipt aria-hidden className="size-4 text-ink-2" /> Expenses
            <span className="text-[12.5px] font-normal text-ink-3 tnum">{expenses.length}</span>
          </h3>
          <Button size="sm" variant="secondary" className="h-11 md:h-8" aria-label="Add an expense" onClick={(e) => open(null, e.currentTarget)}>
            <Plus aria-hidden className="size-4" /> Add
          </Button>
        </header>
        {expenses.length ? (
          <>
            <ul className="divide-y divide-divider">
              {shown.map((e) => (
                <ExpenseRow key={e.id} e={e} demo={demo} onEdit={open} />
              ))}
            </ul>
            {expenses.length > FIRST ? (
              <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="flex h-11 w-full items-center justify-center border-t border-divider text-[13px] font-medium text-teal hover:bg-surface-2">
                {all ? 'Show fewer' : `Show all ${expenses.length}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="px-4 py-4 text-[13.5px] text-ink-2">No expenses recorded. Add what you spend — tickets, rentals, lessons, travel — to see actual spending and cost per ski day.</p>
        )}
      </section>

      <ExpenseSheet
        key={sheet.seq}
        open={sheet.open}
        onOpenChange={(v) => setSheet((s) => ({ ...s, open: v }))}
        expense={sheet.expense}
        trips={trips}
        currency={currency}
        today={today}
        demo={demo}
        onCloseAutoFocus={(ev) => {
          if (opener && document.contains(opener)) {
            ev.preventDefault()
            opener.focus()
          }
        }}
      />
    </div>
  )
}
