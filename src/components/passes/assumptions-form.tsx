'use client'
/**
 * Day-basket assumptions — the same for every resort so tiers compare like with like: rental option, lunch estimate
 * and party size (splits per-vehicle parking). Saved to preferences, so Explore, Today and resort pages use them too.
 */
import { useId, useState, useTransition, type FormEvent } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { useToast } from '@/components/ui/toast'
import { saveBasketAssumptions } from '@/lib/actions/passes'
import { cn } from '@/lib/ui/cn'

type Rental = 'full-package' | 'skis-only' | 'boots-only' | 'none'

const RENTAL_OPTIONS: { value: Rental; label: string; hint: string }[] = [
  { value: 'full-package', label: 'Full rental', hint: 'Skis, boots and poles' },
  { value: 'skis-only', label: 'Skis only', hint: 'You bring boots' },
  { value: 'boots-only', label: 'Boots only', hint: 'You bring skis' },
  { value: 'none', label: 'Own gear', hint: 'No rental' },
]

export function AssumptionsForm({
  rentalOption,
  lunchMajor,
  lunchCurrency,
  partySize,
  maxParty,
}: {
  rentalOption: Rental
  /** Current lunch estimate in major units, e.g. "25.00". */
  lunchMajor: string
  lunchCurrency: string
  partySize: number
  maxParty: number
}) {
  const id = useId()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [rental, setRental] = useState<Rental>(rentalOption)
  const [lunch, setLunch] = useState(lunchMajor)
  const [party, setParty] = useState(partySize)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = rental !== rentalOption || lunch.trim() !== lunchMajor || party !== partySize

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // An empty lunch is not "free lunch": ask for a number (0 when you bring your own).
    if (!lunch.trim()) {
      setErrors({ lunch: 'Enter your estimate — 0 if you bring lunch' })
      return
    }
    start(async () => {
      const res = await saveBasketAssumptions({ rentalOption: rental, lunch: lunch.trim().replace(/,/g, ''), partySize: party })
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { _: res.error })
        return
      }
      setErrors({})
      toast.show(res.message ?? 'Assumptions saved')
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-describedby={`${id}-note`}>
      <div className="flex flex-col gap-1.5">
        <Segmented label="Rental" hideLabel={false} value={rental} onChange={setRental} options={RENTAL_OPTIONS} className="max-w-full [&>div]:flex-wrap" />
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-lunch`} className="text-[12.5px] font-medium text-ink-2">
            Lunch, per person
          </label>
          <div className="flex items-center gap-2">
            <div className="w-[112px]">
              <TextInput
                id={`${id}-lunch`}
                inputMode="decimal"
                value={lunch}
                onChange={(e) => setLunch(e.target.value)}
                aria-invalid={!!errors.lunch}
                aria-describedby={`${id}-lunch-hint`}
                className="tnum"
              />
            </div>
            <span className="text-[13.5px] text-ink-2">{lunchCurrency}</span>
          </div>
          <p id={`${id}-lunch-hint`} className={cn('text-[12px]', errors.lunch ? 'font-medium text-critical' : 'text-ink-3')}>
            {errors.lunch ?? 'Your estimate · 0 if you bring lunch'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-party-label`} className="text-[12.5px] font-medium text-ink-2">
            Party size
          </span>
          <div role="group" aria-labelledby={`${id}-party-label`} className="inline-flex items-center rounded-md border border-divider-strong bg-surface">
            <button
              type="button"
              onClick={() => setParty((n) => Math.max(1, n - 1))}
              disabled={party <= 1}
              aria-label="One fewer person"
              className="inline-flex size-10 items-center justify-center text-ink-2 hover:text-teal disabled:opacity-40 max-md:size-11"
            >
              <Minus aria-hidden className="size-4" />
            </button>
            <output aria-live="polite" className="w-10 text-center text-[15px] font-semibold text-ink tnum">
              {party}
            </output>
            <button
              type="button"
              onClick={() => setParty((n) => Math.min(maxParty, n + 1))}
              disabled={party >= maxParty}
              aria-label="One more person"
              className="inline-flex size-10 items-center justify-center text-ink-2 hover:text-teal disabled:opacity-40 max-md:size-11"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>
          <p className="text-[12px] text-ink-3">Splits per-car parking</p>
        </div>
        <div className="flex flex-col gap-1.5 self-end pb-6">
          <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || pending} className="max-md:min-h-11">
            {pending ? 'Saving…' : dirty ? 'Save assumptions' : (
              <>
                <Check aria-hidden className="size-4" /> Saved
              </>
            )}
          </Button>
        </div>
      </div>
      {errors._ ? (
        <p role="alert" className="text-[13px] font-medium text-critical">
          {errors._}
        </p>
      ) : null}
      <p id={`${id}-note`} className="text-[12.5px] text-ink-3">
        Saved to your preferences: resort pages, Explore and Today use the same rental option and lunch estimate; party size splits parking here. Lessons,
        lodging and long-distance travel are itemised in trips, not in the day basket.
      </p>
    </form>
  )
}
