'use client'
/**
 * Your own price estimate where nothing is on file: a lift ticket, rental or parking at one resort, or a pass price.
 * Saved as a user-estimate snapshot for the season — labelled "Your estimate" everywhere, never a published price or an
 * observed quote, and outranked by one as soon as it is recorded. The same sheet edits or removes an estimate; every
 * change answers with an Undo toast.
 */
import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { PenLine, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { addPriceEstimate, removePriceEstimate, restorePriceEstimate, updatePriceEstimate } from '@/lib/actions/passes'
import type { EstimateDayType, EstimateRental, EstimateSubject, EstimateView } from '@/lib/data/passes-screen'
import { cn } from '@/lib/ui/cn'
import { DAY_TYPE_LABEL, estimateWhat } from './format'

type Trigger = 'link' | 'chip' | 'icon'

export interface EstimateButtonProps {
  subject: EstimateSubject
  /** Resort id, or the product id for a pass price. */
  subjectId: string
  /** Resort or product name, for titles and labels. */
  subjectName: string
  rentalOption?: EstimateRental | null
  /** Day type to start from (the day being priced). */
  dayType?: EstimateDayType
  currencies: string[]
  defaultCurrency: string
  seasonLabel: string
  /** Edit this estimate instead of adding one. */
  existing?: EstimateView | null
  /** Why the estimate is needed, e.g. "No weekend lift ticket price is on file for Sat 16 Jan." */
  context?: ReactNode
  trigger?: Trigger
  label?: string
  className?: string
}

export function EstimateButton({ trigger = 'link', label, className, ...props }: EstimateButtonProps) {
  const [open, setOpen] = useState(false)
  const what = estimateWhat(props.subject, props.rentalOption ?? props.existing?.rentalOption)
  const editing = !!props.existing
  const text = label ?? (editing ? 'Edit your estimate' : 'Add estimate')
  // The accessible name starts with the visible text and says what and where (rows repeat the same button text).
  const name = trigger === 'icon' ? (editing ? `Edit your ${what} estimate for ${props.subjectName}` : `Add your ${what} estimate for ${props.subjectName}`) : `${text} — ${what}, ${props.subjectName}`
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      side="responsive"
      title={editing ? `Edit your ${what} estimate` : `Your ${what} estimate`}
      description={`${props.subjectName} · ${props.seasonLabel} season. Saved as your estimate — never shown as a published price.`}
      trigger={
        trigger === 'icon' ? (
          <button
            type="button"
            aria-label={name}
            title={name}
            className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-teal max-md:size-11', className)}
          >
            <PenLine aria-hidden className="size-4" />
          </button>
        ) : trigger === 'chip' ? (
          <button
            type="button"
            aria-label={name}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-teal/60 bg-surface px-2.5 text-[12.5px] font-medium whitespace-nowrap text-teal transition-colors hover:border-teal hover:bg-glacier/50 max-md:h-11',
              className,
            )}
          >
            {editing ? <PenLine aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
            {text}
          </button>
        ) : (
          <button
            type="button"
            aria-label={name}
            className={cn('inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[12.5px] font-medium whitespace-nowrap text-teal hover:underline max-md:min-h-11', className)}
          >
            {editing ? <PenLine aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
            {text}
          </button>
        )
      }
    >
      <EstimateForm key={open ? 'open' : 'closed'} {...props} onDone={() => setOpen(false)} />
    </Sheet>
  )
}

function EstimateForm({
  subject,
  subjectId,
  subjectName,
  rentalOption,
  dayType = 'any',
  currencies,
  defaultCurrency,
  existing,
  context,
  onDone,
}: Omit<EstimateButtonProps, 'trigger' | 'label' | 'className' | 'seasonLabel'> & { onDone: () => void }) {
  const id = useId()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [dt, setDt] = useState<EstimateDayType>(existing?.dayType ?? dayType)
  const [amount, setAmount] = useState(existing?.amountMajor ?? '')
  const [max, setMax] = useState(existing?.amountMaxMajor ?? '')
  const [currency, setCurrency] = useState(existing?.amount.currency ?? defaultCurrency)
  const [note, setNote] = useState(existing?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const isPass = subject === 'pass-product'
  const what = estimateWhat(subject, rentalOption ?? existing?.rentalOption)
  const choices = currencies.includes(currency) ? currencies : [currency, ...currencies]

  const fail = (e: string, fields?: Record<string, string>) => {
    setError(e)
    setErrors(fields ?? {})
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!amount.trim()) return fail('Enter your estimate', { amount: 'Enter an amount' })
    start(async () => {
      const fields = { dayType: isPass ? ('any' as const) : dt, amount: amount.trim(), amountMax: max.trim() || null, currency, note: note.trim() || null }
      if (existing) {
        const res = await updatePriceEstimate({ id: existing.id, ...fields })
        if (!res.ok) return fail(res.error, res.fieldErrors)
        onDone()
        const previous = res.data.previous
        toast.show(res.message ?? 'Estimate updated', {
          undo: async () => {
            const r = await restorePriceEstimate({ snapshot: previous })
            toast.show(r.ok ? 'Previous estimate restored' : r.error, { tone: r.ok ? 'success' : 'error' })
          },
        })
        return
      }
      const res = await addPriceEstimate({ subject, subjectId, rentalOption: subject === 'rental' ? rentalOption : null, ...fields })
      if (!res.ok) return fail(res.error, res.fieldErrors)
      onDone()
      const estimateId = res.data.id
      toast.show(res.message ?? 'Estimate saved', {
        undo: async () => {
          const r = await removePriceEstimate({ id: estimateId })
          toast.show(r.ok ? 'Estimate removed' : r.error, { tone: r.ok ? 'info' : 'error' })
        },
      })
    })
  }

  const remove = () =>
    start(async () => {
      if (!existing) return
      const res = await removePriceEstimate({ id: existing.id })
      if (!res.ok) return fail(res.error)
      onDone()
      const snapshot = res.data.snapshot
      toast.show(res.message ?? 'Estimate removed', {
        undo: async () => {
          const r = await restorePriceEstimate({ snapshot })
          toast.show(r.ok ? 'Estimate restored' : r.error, { tone: r.ok ? 'success' : 'error' })
        },
      })
    })

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-[13.5px] font-medium text-critical">
          {error}
        </p>
      ) : null}
      {context ? <div className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{context}</div> : null}
      {!isPass ? (
        <div className="flex flex-col gap-1">
          <Segmented
            label="Applies on"
            hideLabel={false}
            value={dt}
            onChange={setDt}
            options={(['weekday', 'weekend', 'holiday', 'any'] as const).map((v) => ({ value: v, label: DAY_TYPE_LABEL[v] }))}
            className="max-w-full [&>div]:flex-wrap"
          />
          {errors.dayType ? <p className="text-[12.5px] font-medium text-critical">{errors.dayType}</p> : null}
          <p className="text-[12.5px] text-ink-3">A weekday price is never used for a weekend or holiday — “Any day” applies to all three.</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_1fr_104px]">
        <Field label={subject === 'parking' ? 'Per vehicle' : isPass ? 'Pass price' : 'Per person'} htmlFor={`${id}-amount`} error={errors.amount}>
          <TextInput id={`${id}-amount`} inputMode="decimal" placeholder={isPass ? 'e.g. 1099' : 'e.g. 89'} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} className="tnum" />
        </Field>
        <Field label="Up to" optional htmlFor={`${id}-max`} error={errors.amountMax} hint="For a range">
          <TextInput id={`${id}-max`} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-invalid={!!errors.amountMax} className="tnum" />
        </Field>
        <Field label="Currency" htmlFor={`${id}-cur`} className="col-span-2 sm:col-span-1">
          <Select id={`${id}-cur`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Where the number comes from" optional htmlFor={`${id}-note`} error={errors.note} hint="E.g. “last season’s window price + 5%”">
        <TextInput id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <p className="text-[12.5px] text-ink-3">
        {isPass
          ? `Used for ${subjectName} in Pass vs tickets until a published price is recorded, which then takes precedence. It is labelled “Your estimate” wherever it appears.`
          : `Fills the ${what} gap at ${subjectName} for the whole season until a published price or observed quote is recorded, which then takes precedence. It is labelled “Your estimate” in every basket and comparison.`}
      </p>
      <div className="flex flex-col-reverse gap-2 border-t border-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
        {existing ? (
          <Button variant="ghost" onClick={remove} disabled={pending} className="text-ink-2 hover:text-critical max-md:min-h-11">
            <Trash2 aria-hidden className="size-4" /> Remove estimate
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
          {pending ? 'Saving…' : existing ? 'Save changes' : 'Save estimate'}
        </Button>
      </div>
    </form>
  )
}

/** Remove one of your estimates straight from a list (with Undo). */
export function RemoveEstimateButton({ id, label }: { id: number; label: string }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await removePriceEstimate({ id })
          if (!res.ok) {
            toast.show(res.error, { tone: 'error' })
            return
          }
          const snapshot = res.data.snapshot
          toast.show(res.message ?? 'Estimate removed', {
            undo: async () => {
              const r = await restorePriceEstimate({ snapshot })
              toast.show(r.ok ? 'Estimate restored' : r.error, { tone: r.ok ? 'success' : 'error' })
            },
          })
        })
      }
      aria-label={`Remove your estimate: ${label}`}
      title="Remove your estimate"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-critical disabled:opacity-50 max-md:size-11"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  )
}
