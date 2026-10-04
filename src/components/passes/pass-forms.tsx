'use client'
/**
 * Ownership and usage controls: add a pass you (or a companion) hold, log a skied day, remove a day or a pass — each
 * removal answers with an Undo toast that restores the exact records (ids, logged days, linked purchase expense).
 */
import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { CalendarPlus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { addOwnedPass, logPassDay, removeOwnedPass, removePassDay, restoreOwnedPass, restorePassDay } from '@/lib/actions/passes'
import { cn } from '@/lib/ui/cn'
import { shiftDate } from './params'

export interface ProductChoice {
  id: string
  name: string
  familyName: string
  /** Already recorded as mine. */
  mine: boolean
}

export interface ResortChoice {
  id: string
  name: string
  region: string
  /** Status of this pass at the resort, e.g. "2 days left" / "Not included"; null = no rule recorded. */
  status: string | null
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return [...m]
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-[13.5px] font-medium text-critical">
      {error}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Add a pass

export function AddPassButton({
  products,
  currencies,
  defaultCurrency,
  today,
  preselect,
  label = 'Add a pass you own',
  variant = 'secondary',
  size = 'md',
  className,
  icon = true,
}: {
  products: ProductChoice[]
  currencies: string[]
  defaultCurrency: string
  today: string
  preselect?: string | null
  label?: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet' | 'ghost'
  size?: 'sm' | 'md'
  className?: string
  icon?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Add a pass you own"
      description="Recording a pass never changes what it covers — access still comes from the product’s own rules."
      trigger={
        <Button variant={variant} size={size} className={cn('max-md:min-h-11', className)}>
          {icon ? <Plus aria-hidden className="size-4" /> : null}
          {label}
        </Button>
      }
    >
      <AddPassForm key={open ? 'open' : 'closed'} products={products} currencies={currencies} defaultCurrency={defaultCurrency} today={today} preselect={preselect ?? null} onDone={() => setOpen(false)} />
    </Sheet>
  )
}

function AddPassForm({
  products,
  currencies,
  defaultCurrency,
  today,
  preselect,
  onDone,
}: {
  products: ProductChoice[]
  currencies: string[]
  defaultCurrency: string
  today: string
  preselect: string | null
  onDone: () => void
}) {
  const id = useId()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [productId, setProductId] = useState(preselect && products.some((p) => p.id === preselect && !p.mine) ? preselect : '')
  const [who, setWho] = useState<'me' | 'other'>('me')
  const [name, setName] = useState('')
  const [purchasedOn, setPurchasedOn] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!productId) {
      setErrors({ productId: 'Choose the pass you hold' })
      return
    }
    if (who === 'other' && !name.trim()) {
      setErrors({ holder: 'Whose pass is it?' })
      return
    }
    start(async () => {
      const res = await addOwnedPass({
        productId,
        holder: who === 'me' ? 'me' : name,
        purchasedOn: purchasedOn || null,
        price: price.trim() || null,
        currency,
        notes: notes || null,
      })
      if (!res.ok) {
        setError(res.error)
        setErrors(res.fieldErrors ?? {})
        return
      }
      onDone()
      const ownershipId = res.data.ownershipId
      toast.show(res.message ?? 'Pass added', {
        undo: async () => {
          const r = await removeOwnedPass({ ownershipId })
          toast.show(r.ok ? 'Pass removed' : r.error, { tone: r.ok ? 'info' : 'error' })
        },
      })
    })
  }

  const groups = groupBy(products, (p) => p.familyName)
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError error={error} />
      <Field label="Pass product" htmlFor={`${id}-product`} error={errors.productId} hint="Exact 2026–27 product — the family badge alone never implies access.">
        <Select id={`${id}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} aria-invalid={!!errors.productId} required>
          <option value="" disabled>
            Choose a pass…
          </option>
          {groups.map(([fam, list]) => (
            <optgroup key={fam} label={fam}>
              {list.map((p) => (
                <option key={p.id} value={p.id} disabled={p.mine}>
                  {p.name}
                  {p.mine ? ' — already yours' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-1.5">
        <Segmented
          label="Who holds it"
          hideLabel={false}
          value={who}
          onChange={setWho}
          options={[
            { value: 'me', label: 'Me' },
            { value: 'other', label: 'Someone else' },
          ]}
        />
        {who === 'other' ? (
          <Field label="Holder’s name" htmlFor={`${id}-holder`} error={errors.holder} className="mt-2">
            <TextInput id={`${id}-holder`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} aria-invalid={!!errors.holder} />
          </Field>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purchase date" optional htmlFor={`${id}-date`} error={errors.purchasedOn}>
          <DatePicker id={`${id}-date`} value={purchasedOn} max={today} today={today} onChange={setPurchasedOn} clearable placeholder="Not recorded" aria-invalid={!!errors.purchasedOn} />
        </Field>
        <Field label="Price paid" optional htmlFor={`${id}-price`} error={errors.price ?? errors.currency}>
          <div className="flex gap-2">
            <TextInput
              id={`${id}-price`}
              inputMode="decimal"
              placeholder="e.g. 369.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="min-w-0 flex-1 tnum"
              aria-invalid={!!errors.price}
              aria-describedby={`${id}-price-note`}
            />
            <div className="w-[92px] shrink-0">
              <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            </div>
          </div>
        </Field>
      </div>
      <p id={`${id}-price-note`} className="-mt-2 text-[12.5px] text-ink-3">
        A price is also recorded once as a linked “pass” expense in your season budget — never as daily lift cash. Leave it empty if you don’t know it (it
        stays unknown, not $0).
      </p>
      <Field label="Notes" optional htmlFor={`${id}-notes`}>
        <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-20" />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-divider pt-4">
        <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
          {pending ? 'Saving…' : 'Add pass'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Log a day

export function LogDayButton({
  ownershipId,
  productName,
  resorts,
  today,
  seasonStart,
  className,
}: {
  ownershipId: number
  productName: string
  resorts: ResortChoice[]
  today: string
  seasonStart: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`Log a day on ${productName}`}
      description="Record a day you skied on this pass. Logged days count against day limits and shared pools."
      trigger={
        <Button variant="quiet" size="sm" className={cn('max-md:h-11', className)}>
          <CalendarPlus aria-hidden className="size-4" />
          Log a day
        </Button>
      }
    >
      <LogDayForm key={open ? 'open' : 'closed'} ownershipId={ownershipId} resorts={resorts} today={today} seasonStart={seasonStart} onDone={() => setOpen(false)} />
    </Sheet>
  )
}

function LogDayForm({ ownershipId, resorts, today, seasonStart, onDone }: { ownershipId: number; resorts: ResortChoice[]; today: string; seasonStart: string; onDone: () => void }) {
  const id = useId()
  const toast = useToast()
  const [pending, start] = useTransition()
  const onPass = resorts.filter((r) => r.status !== null)
  const [resortId, setResortId] = useState(onPass.length === 1 ? onPass[0].id : '')
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const chosen = resorts.find((r) => r.id === resortId) ?? null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!resortId) {
      setErrors({ resortId: 'Choose where you skied' })
      return
    }
    start(async () => {
      const res = await logPassDay({ ownershipId, resortId, date, notes: notes || null })
      if (!res.ok) {
        setError(res.error)
        setErrors(res.fieldErrors ?? {})
        return
      }
      onDone()
      const usageId = res.data.usageId
      toast.show(res.message ?? 'Day logged', {
        undo: async () => {
          const r = await removePassDay({ usageId })
          toast.show(r.ok ? 'Logged day removed' : r.error, { tone: r.ok ? 'info' : 'error' })
        },
      })
      if (res.data.warning) toast.show(res.data.warning, { tone: 'info', durationMs: 8000 })
    })
  }

  const others = resorts.filter((r) => r.status === null)
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError error={error} />
      <Field
        label="Resort"
        htmlFor={`${id}-resort`}
        error={errors.resortId}
        hint={chosen ? (chosen.status ? `On this pass: ${chosen.status}` : 'No rule recorded for this pass here — the day is logged, but no allowance is known.') : undefined}
      >
        <Select id={`${id}-resort`} value={resortId} onChange={(e) => setResortId(e.target.value)} aria-invalid={!!errors.resortId} required>
          <option value="" disabled>
            Choose a resort…
          </option>
          {onPass.length ? (
            <optgroup label="Rules recorded for this pass">
              {onPass.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.status}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Other resorts (no rule recorded)">
            {others.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Date skied" htmlFor={`${id}-date`} error={errors.date} hint="Today or earlier">
        <DatePicker id={`${id}-date`} value={date} min={seasonStart} max={today} today={today} onChange={(v) => v && setDate(v)} presets={[
            { label: 'Today', date: today },
            { label: 'Yesterday', date: shiftDate(today, -1) },
          ]} aria-invalid={!!errors.date} required />
      </Field>
      <Field label="Notes" optional htmlFor={`${id}-notes`}>
        <TextInput id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
      </Field>
      <div className="flex justify-end border-t border-divider pt-4">
        <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
          {pending ? 'Saving…' : 'Log day'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Removals with undo

export function RemoveDayButton({ usageId, label }: { usageId: number; label: string }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await removePassDay({ usageId })
          if (!res.ok) {
            toast.show(res.error, { tone: 'error' })
            return
          }
          const snapshot = res.data.snapshot
          toast.show(res.message ?? 'Day removed', {
            undo: async () => {
              const r = await restorePassDay({ snapshot })
              toast.show(r.ok ? 'Day restored' : r.error, { tone: r.ok ? 'success' : 'error' })
            },
          })
        })
      }
      aria-label={`Remove logged day: ${label}`}
      title="Remove this logged day"
      className="-my-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-critical disabled:opacity-50 max-md:size-11"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  )
}

export function RemovePassButton({ ownershipId, productName, className }: { ownershipId: number; productName: string; className?: string }) {
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className={cn('text-ink-2 hover:text-critical max-md:h-11', className)}
      onClick={() =>
        start(async () => {
          const res = await removeOwnedPass({ ownershipId })
          if (!res.ok) {
            toast.show(res.error, { tone: 'error' })
            return
          }
          const snapshot = res.data.snapshot
          toast.show(res.message ?? `${productName} removed`, {
            undo: async () => {
              const r = await restoreOwnedPass({ snapshot })
              toast.show(r.ok ? `${productName} restored` : r.error, { tone: r.ok ? 'success' : 'error' })
            },
          })
        })
      }
    >
      <Trash2 aria-hidden className="size-4" />
      Remove pass
    </Button>
  )
}
