'use client'
/**
 * Manual access-rule entry for one exact product at one resort. Saving inserts a NEW version (the earlier record
 * and every earlier version stay in the history) labelled "Manual — you entered", with a required source link.
 * Blackouts must be answered explicitly: "no blackout dates" is a statement, so it is never the silent default.
 */
import { useId, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/date-picker'
import { Field, Select, Textarea, TextInput } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { useToast } from '@/components/ui/toast'
import { saveAccessRule } from '@/lib/actions/passes'
import type { PassAccessType } from '@/lib/domain/types'
import { cn } from '@/lib/ui/cn'
import { ACCESS_TYPE_HINT, ACCESS_TYPE_LABEL, plural } from './format'

interface Initial {
  access: PassAccessType
  days: number | null
  poolId: string | null
  poolLabel: string | null
  blackouts: { from: string; to: string; label: string | null }[]
  reservationRequired: boolean | null
  reservationNotes: string | null
  discountText: string | null
  eligibilityNotes: string | null
  notes: string | null
}

const ACCESS_ORDER: PassAccessType[] = ['unlimited', 'limited-days', 'shared-pool', 'discount-only', 'not-included', 'unknown']
type Blackout = { key: number; from: string; to: string; label: string }

export function RuleEditor({
  productId,
  productName,
  resortId,
  resortName,
  nextVersion,
  initial,
  pools,
  season,
  today,
  links,
  returnHref,
}: {
  productId: string
  productName: string
  resortId: string
  resortName: string
  nextVersion: number
  initial: Initial | null
  pools: { id: string; label: string | null; total: number | null; members: string[] }[]
  season: { start: string; end: string; label: string }
  /** The app's today (rings today in the calendar). */
  today: string
  links: { label: string; url: string }[]
  returnHref: string
}) {
  const id = useId()
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [access, setAccess] = useState<PassAccessType>(initial?.access ?? 'unknown')
  const [days, setDays] = useState(initial?.days != null ? String(initial.days) : '')
  const [poolChoice, setPoolChoice] = useState<string>(initial?.poolId ?? '')
  const [poolLabel, setPoolLabel] = useState(initial?.poolLabel ?? '')
  const [blackoutAnswer, setBlackoutAnswer] = useState<'none' | 'dates' | ''>(initial?.blackouts.length ? 'dates' : '')
  const [blackouts, setBlackouts] = useState<Blackout[]>((initial?.blackouts ?? []).map((b, i) => ({ key: i, from: b.from, to: b.to, label: b.label ?? '' })))
  const [reservation, setReservation] = useState<'yes' | 'no' | 'unknown'>(initial?.reservationRequired === true ? 'yes' : initial?.reservationRequired === false ? 'no' : 'unknown')
  const [reservationNotes, setReservationNotes] = useState(initial?.reservationNotes ?? '')
  const [discountText, setDiscountText] = useState(initial?.discountText ?? '')
  const [eligibility, setEligibility] = useState(initial?.eligibilityNotes ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(blackouts.length)

  const needsDays = access === 'limited-days' || access === 'shared-pool'
  // Effective pool choice: a shared pool must name one (a new one when none exists); a day cap may stand alone.
  const poolSel = access === 'shared-pool' ? (poolChoice && poolChoice !== 'none' ? poolChoice : pools.length ? '' : 'new') : poolChoice || 'none'
  const usesPool = access === 'shared-pool' || (access === 'limited-days' && poolSel !== 'none')
  const grantsAccess = access === 'unlimited' || access === 'limited-days' || access === 'shared-pool' || access === 'discount-only'
  const chosenPool = pools.find((p) => p.id === poolSel) ?? null

  const addBlackout = () => {
    setBlackouts((xs) => [...xs, { key: seq, from: '', to: '', label: '' }])
    setSeq((n) => n + 1)
    setBlackoutAnswer('dates')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (grantsAccess && !blackoutAnswer) local.blackoutAnswer = 'Say whether the official page lists blackout dates'
    if (blackoutAnswer === 'dates' && grantsAccess && !blackouts.some((b) => b.from && b.to)) local.blackoutAnswer = 'Enter at least one blackout range, or choose “No blackout dates”'
    if (Object.keys(local).length) {
      setErrors(local)
      setError('Please check the highlighted fields')
      return
    }
    start(async () => {
      const res = await saveAccessRule({
        productId,
        resortId,
        access,
        days: needsDays && days.trim() ? Number(days) : null,
        poolId: usesPool && chosenPool ? chosenPool.id : null,
        poolLabel: usesPool && poolSel === 'new' ? poolLabel || null : chosenPool ? chosenPool.label : null,
        blackouts: grantsAccess && blackoutAnswer === 'dates' ? blackouts.filter((b) => b.from || b.to).map((b) => ({ from: b.from, to: b.to || b.from, label: b.label || null })) : [],
        reservationRequired: reservation === 'yes' ? true : reservation === 'no' ? false : null,
        reservationNotes: reservationNotes || null,
        discountText: discountText || null,
        eligibilityNotes: eligibility || null,
        notes: notes || null,
        sourceUrl,
        sourceLabel: sourceLabel || null,
      })
      if (!res.ok) {
        setError(res.error)
        setErrors(res.fieldErrors ?? {})
        return
      }
      toast.show(res.message ?? 'Rule saved')
      router.push(returnHref)
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-[13.5px] font-medium text-critical">
          {error}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-semibold text-ink">What does {productName} give you at {resortName}?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACCESS_ORDER.map((a) => {
            const on = a === access
            return (
              <label
                key={a}
                className={cn(
                  'flex min-h-14 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors duration-150',
                  on ? 'border-teal bg-glacier/60' : 'border-divider bg-surface hover:border-divider-strong',
                  a === 'unknown' && !on && 'border-dashed',
                )}
              >
                <input type="radio" name={`${id}-access`} value={a} checked={on} onChange={() => setAccess(a)} className="mt-1 size-4 shrink-0 accent-[var(--teal)]" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{ACCESS_TYPE_LABEL[a]}</span>
                  <span className="block text-[12.5px] text-ink-3">{ACCESS_TYPE_HINT[a]}</span>
                </span>
              </label>
            )
          })}
        </div>
        {errors.access ? <p className="text-[12.5px] font-medium text-critical">{errors.access}</p> : null}
      </fieldset>

      {needsDays ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={access === 'shared-pool' ? 'Days in the whole pool' : `Days at ${resortName}`}
            htmlFor={`${id}-days`}
            error={errors.days}
            hint={access === 'shared-pool' ? 'Total shared by every resort in the pool' : 'Per season, on this pass'}
          >
            <TextInput id={`${id}-days`} type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!!errors.days} className="tnum" />
          </Field>
          <Field
            label={access === 'shared-pool' ? 'Pool' : 'Also counts against a shared pool?'}
            htmlFor={`${id}-pool`}
            error={errors.poolId ?? (poolSel === '' ? errors.poolLabel : undefined)}
            hint={chosenPool ? `Currently: ${chosenPool.members.join(', ') || 'no resorts yet'}${chosenPool.total != null ? ` · ${plural(chosenPool.total, 'day')}` : ''}` : undefined}
          >
            <Select id={`${id}-pool`} value={poolSel} onChange={(e) => setPoolChoice(e.target.value)} aria-invalid={!!errors.poolId}>
              {access === 'limited-days' ? <option value="none">No — a cap at this resort only</option> : <option value="" disabled>Choose a pool…</option>}
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  Join “{p.label ?? p.id}”
                </option>
              ))}
              <option value="new">New pool…</option>
            </Select>
          </Field>
          {usesPool && poolSel === 'new' ? (
            <Field label="Pool name" htmlFor={`${id}-pool-label`} error={errors.poolLabel} hint="E.g. “Alta + Snowbird”. Enter the same pool on each member resort’s rule." className="sm:col-span-2">
              <TextInput id={`${id}-pool-label`} value={poolLabel} onChange={(e) => setPoolLabel(e.target.value)} maxLength={80} aria-invalid={!!errors.poolLabel} />
            </Field>
          ) : null}
        </div>
      ) : null}

      {access === 'discount-only' ? (
        <Field label="Discount terms" htmlFor={`${id}-discount`} error={errors.discountText} hint="As stated on the official page, e.g. “25% off window tickets”">
          <TextInput id={`${id}-discount`} value={discountText} onChange={(e) => setDiscountText(e.target.value)} maxLength={300} />
        </Field>
      ) : null}

      {grantsAccess ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[14px] font-semibold text-ink">Blackout dates at {resortName}</legend>
          <div role="radiogroup" aria-label="Does the official page list blackout dates?" className="flex flex-wrap gap-2">
            {(
              [
                ['none', 'No blackout dates listed'],
                ['dates', 'Yes — enter them'],
              ] as const
            ).map(([v, l]) => (
              <label
                key={v}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[14px] md:min-h-10',
                  blackoutAnswer === v ? 'border-teal bg-glacier/60 text-ink' : 'border-divider bg-surface text-ink-2',
                )}
              >
                <input type="radio" name={`${id}-bo`} checked={blackoutAnswer === v} onChange={() => (v === 'dates' && !blackouts.length ? addBlackout() : setBlackoutAnswer(v))} className="size-4 accent-[var(--teal)]" />
                {l}
              </label>
            ))}
          </div>
          {errors.blackoutAnswer ? <p className="text-[12.5px] font-medium text-critical">{errors.blackoutAnswer}</p> : null}
          {blackoutAnswer === 'dates' ? (
            <div className="flex flex-col gap-2">
              {blackouts.map((b, i) => (
                <div key={b.key} className="flex flex-wrap items-end gap-2 rounded-[10px] bg-surface-2 p-2.5">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                    <label htmlFor={`${id}-bo-${b.key}-dates`} className="text-[12px] text-ink-2">
                      Dates (inclusive)
                    </label>
                    <DateRangePicker
                      id={`${id}-bo-${b.key}-dates`}
                      value={{ start: b.from, end: b.to }}
                      min={season.start}
                      max={season.end}
                      presets={false}
                      today={today}
                      placeholder="Pick the blacked-out days"
                      onChange={(v) => setBlackouts((xs) => xs.map((x) => (x.key === b.key ? { ...x, from: v.start, to: v.end || v.start } : x)))}
                      aria-invalid={!!errors[`blackouts.${i}.from`] || !!errors[`blackouts.${i}.to`]}
                    />
                  </div>
                  <div className="flex min-w-[140px] flex-1 flex-col gap-1">
                    <label htmlFor={`${id}-bo-${b.key}-label`} className="text-[12px] text-ink-2">
                      Label <span className="text-ink-3">(optional)</span>
                    </label>
                    <TextInput id={`${id}-bo-${b.key}-label`} value={b.label} placeholder="e.g. Holiday period" maxLength={60} onChange={(e) => setBlackouts((xs) => xs.map((x) => (x.key === b.key ? { ...x, label: e.target.value } : x)))} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setBlackouts((xs) => xs.filter((x) => x.key !== b.key))}
                    aria-label={`Remove blackout range ${i + 1}`}
                    className="inline-flex size-10 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-critical max-md:size-11"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                  {errors[`blackouts.${i}.from`] || errors[`blackouts.${i}.to`] ? (
                    <p className="w-full text-[12.5px] font-medium text-critical">{errors[`blackouts.${i}.from`] ?? errors[`blackouts.${i}.to`]}</p>
                  ) : null}
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={addBlackout} className="self-start text-teal max-md:h-11">
                <Plus aria-hidden className="size-4" /> Add a range
              </Button>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {grantsAccess ? (
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <Segmented
            label="Reservation"
            hideLabel={false}
            value={reservation}
            onChange={setReservation}
            options={[
              { value: 'yes', label: 'Required' },
              { value: 'no', label: 'Not required' },
              { value: 'unknown', label: 'Not stated' },
            ]}
          />
          <Field label="Reservation notes" optional htmlFor={`${id}-res-notes`}>
            <TextInput id={`${id}-res-notes`} value={reservationNotes} onChange={(e) => setReservationNotes(e.target.value)} maxLength={500} placeholder="e.g. Book 48 h ahead online" />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Eligibility" optional htmlFor={`${id}-elig`} hint="Age, residency or other conditions">
          <TextInput id={`${id}-elig`} value={eligibility} onChange={(e) => setEligibility(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Notes" optional htmlFor={`${id}-notes`}>
          <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="min-h-11" rows={1} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-[18px] border border-divider bg-surface-2 p-4">
        <legend className="px-1 text-[14px] font-semibold text-ink">Source</legend>
        <Field label="Link to the official page you read" htmlFor={`${id}-src`} error={errors.sourceUrl} hint="Required — every manual rule keeps its source.">
          <TextInput id={`${id}-src`} type="url" inputMode="url" placeholder="https://" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} aria-invalid={!!errors.sourceUrl} required />
        </Field>
        {links.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-ink-3">Use:</span>
            {links.map((l) => (
              <button
                key={l.url}
                type="button"
                onClick={() => {
                  setSourceUrl(l.url)
                  if (!sourceLabel) setSourceLabel(l.label)
                }}
                className="inline-flex h-8 items-center rounded-full border border-divider bg-surface px-3 text-[12.5px] font-medium text-ink-2 hover:border-teal hover:text-teal max-md:h-11"
              >
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
        <Field label="What the page is" optional htmlFor={`${id}-src-label`}>
          <TextInput id={`${id}-src-label`} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} maxLength={120} placeholder="e.g. Indy Pass — Greek Peak resort page" />
        </Field>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
        <ButtonLink href={returnHref} variant="ghost" className="max-md:min-h-11">
          Cancel
        </ButtonLink>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button type="submit" variant="primary" disabled={pending} className="max-md:min-h-11">
            {pending ? 'Saving…' : `Save as version ${nextVersion}`}
          </Button>
          <span className="text-[12px] text-ink-3">Earlier versions stay in the history.</span>
        </div>
      </div>
    </form>
  )
}

