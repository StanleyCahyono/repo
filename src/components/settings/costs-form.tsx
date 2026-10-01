'use client'
/** Gear you own and how you rent the rest, day/season budget with a lunch estimate, and lodging style. */
import { saveCosts } from '@/lib/actions/settings'
import type { BudgetPrefs, GearPrefs } from '@/lib/db/schema'
import { minorDigits } from '@/lib/domain/money'
import { Checkbox, Select, TextInput } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import { BUDGET_CURRENCIES, LODGING_STYLES, LODGING_TEXT, RENTAL_TEXT, type LodgingStyle } from './options'
import { SaveBar } from './save-bar'
import { FieldError, SettingRow, SettingsPanel } from './section'
import { useSave } from './use-save'
import { errorFor, useDraft } from './use-draft'

type Rental = GearPrefs['rentalOption']
const RENTALS: Rental[] = ['full-package', 'skis-only', 'boots-only', 'none']

interface CostsValues {
  ownsSkis: boolean
  ownsBoots: boolean
  ownsHelmet: boolean
  rentalOption: Rental
  currency: string
  dayBudget: string
  seasonBudget: string
  lunchEstimate: string
  lodgingStyle: LodgingStyle | ''
}

const major = (minor: number | null, currency: string) => (minor === null ? '' : (minor / 10 ** minorDigits(currency)).toFixed(minor % 10 ** minorDigits(currency) === 0 ? 0 : minorDigits(currency)))

const toValues = (gear: GearPrefs, budget: BudgetPrefs, lodging: string | null): CostsValues => ({
  ownsSkis: gear.ownsSkis,
  ownsBoots: gear.ownsBoots,
  ownsHelmet: gear.ownsHelmet,
  rentalOption: gear.rentalOption,
  currency: budget.currency,
  dayBudget: major(budget.dayBudgetMinor, budget.currency),
  seasonBudget: major(budget.seasonBudgetMinor, budget.currency),
  lunchEstimate: major(budget.lunchEstimateMinor, budget.currency),
  lodgingStyle: (LODGING_STYLES as readonly string[]).includes(lodging ?? '') ? (lodging as LodgingStyle) : '',
})

const toInput = (v: CostsValues) => ({
  gear: { ownsSkis: v.ownsSkis, ownsBoots: v.ownsBoots, ownsHelmet: v.ownsHelmet, rentalOption: v.rentalOption },
  budget: {
    currency: v.currency as (typeof BUDGET_CURRENCIES)[number],
    dayBudget: v.dayBudget.trim() ? v.dayBudget : null,
    seasonBudget: v.seasonBudget.trim() ? v.seasonBudget : null,
    lunchEstimate: v.lunchEstimate.trim() || '0',
  },
  lodgingStyle: v.lodgingStyle || null,
})

const SYMBOL: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€' }

function MoneyInput({ id, label, value, onChange, currency, error, optional }: { id: string; label: string; value: string; onChange: (v: string) => void; currency: string; error?: string; optional?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-ink-2">
        {label}
        {optional ? <span className="font-normal text-ink-3"> (optional)</span> : null}
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-ink-3">
          {SYMBOL[currency] ?? currency}
        </span>
        <TextInput
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={optional ? 'Not set' : '0'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn('tnum', (SYMBOL[currency] ?? currency).length > 1 ? 'pl-11' : 'pl-7')}
        />
      </div>
      <FieldError id={`${id}-err`} error={error} />
    </div>
  )
}

export function CostsForm({ gear, budget, lodgingStyle }: { gear: GearPrefs; budget: BudgetPrefs; lodgingStyle: string | null }) {
  const d = useDraft(toValues(gear, budget, lodgingStyle))
  const { run, pending } = useSave()
  const v = d.values

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const prev = d.baseline
    run(() => saveCosts(toInput(v)), {
      onDone: (data) => d.commit(toValues(data.gear, data.budget, data.lodgingStyle)),
      onError: (r) => d.setErrors(r.fieldErrors ?? {}),
      undo: () => run(() => saveCosts(toInput(prev)), { onDone: (data) => d.commit(toValues(data.gear, data.budget, data.lodgingStyle)), success: 'Gear, budget and lodging restored' }),
    })
  }

  const err = (k: string) => errorFor(d.errors, k)

  return (
    <SettingsPanel as="form" onSubmit={submit} noValidate aria-label="Gear, budget and lodging">
      <SettingRow label="Gear you own" labelId="gear-label" hint="Rental costs only count what you still need.">
        <div role="group" aria-labelledby="gear-label" className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox label="Skis" checked={v.ownsSkis} onChange={(e) => d.set({ ownsSkis: e.target.checked })} />
          <Checkbox label="Boots" checked={v.ownsBoots} onChange={(e) => d.set({ ownsBoots: e.target.checked })} />
          <Checkbox label="Helmet" checked={v.ownsHelmet} onChange={(e) => d.set({ ownsHelmet: e.target.checked })} />
        </div>
      </SettingRow>
      <SettingRow label="Rental" labelId="rental-label" hint="What a day basket includes. Prices come from each resort’s rental quotes, or stay unknown.">
        <div role="radiogroup" aria-labelledby="rental-label" className="grid max-w-xl gap-2 sm:grid-cols-2">
          {RENTALS.map((r) => {
            const on = v.rentalOption === r
            return (
              <label
                key={r}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[14px] border px-3 py-2.5 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  on ? 'border-teal bg-glacier/60' : 'border-glass-line bg-chip-track hover:border-field-edge',
                )}
              >
                <input type="radio" name="rental" value={r} checked={on} onChange={() => d.set({ rentalOption: r })} className="mt-1 size-4 shrink-0 accent-[var(--teal)] focus-visible:outline-none" />
                <span>
                  <span className="block text-[14px] font-medium text-ink">{RENTAL_TEXT[r].label}</span>
                  <span className="block text-[12.5px] text-ink-3">{RENTAL_TEXT[r].hint}</span>
                </span>
              </label>
            )
          })}
        </div>
        {((v.ownsSkis && (v.rentalOption === 'full-package' || v.rentalOption === 'skis-only')) || (v.ownsBoots && (v.rentalOption === 'full-package' || v.rentalOption === 'boots-only'))) ? (
          <p className="mt-2 text-[12.5px] text-caution">You own some of this gear — a smaller rental option may fit better.</p>
        ) : null}
      </SettingRow>
      <SettingRow
        label="Budget"
        labelId="budget-label"
        hint="Kept in the currency you choose here. Changing it does not convert the amounts — they are stored as typed."
      >
        <div role="group" aria-labelledby="budget-label" className="grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="budget-currency" className="text-[12.5px] font-medium text-ink-2">
              Budget currency
            </label>
            <Select id="budget-currency" value={v.currency} onChange={(e) => d.set({ currency: e.target.value })} className="max-w-[12rem]">
              {BUDGET_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <MoneyInput id="budget-day" label="Per ski day" value={v.dayBudget} onChange={(dayBudget) => d.set({ dayBudget }, ['budget.dayBudget'])} currency={v.currency} error={err('budget.dayBudget')} optional />
          <MoneyInput id="budget-season" label="Whole season" value={v.seasonBudget} onChange={(seasonBudget) => d.set({ seasonBudget }, ['budget.seasonBudget'])} currency={v.currency} error={err('budget.seasonBudget')} optional />
          <MoneyInput id="budget-lunch" label="Lunch estimate" value={v.lunchEstimate} onChange={(lunchEstimate) => d.set({ lunchEstimate }, ['budget.lunchEstimate'])} currency={v.currency} error={err('budget.lunchEstimate')} />
        </div>
        <p className="mt-2 text-[12.5px] text-ink-3">The lunch estimate is your assumption for day costs, labelled as such wherever it is used.</p>
      </SettingRow>
      <SettingRow label="Lodging style" htmlFor="lodging" hint="What kind of stay to look for on overnight trips.">
        <Select id="lodging" value={v.lodgingStyle} onChange={(e) => d.set({ lodgingStyle: e.target.value as LodgingStyle | '' })} className="max-w-xs">
          <option value="">Not set</option>
          {LODGING_STYLES.map((l) => (
            <option key={l} value={l}>
              {LODGING_TEXT[l]}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SaveBar dirty={d.dirty} pending={pending} error={Object.keys(d.errors).length ? 'Check the highlighted fields' : null} onDiscard={d.discard} />
    </SettingsPanel>
  )
}
