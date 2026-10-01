'use client'
/**
 * Filter controls with real semantics and mobile-sized targets (44px below md):
 * - <ChoiceGroup>: single choice (Radix RadioGroup — arrow keys, roving focus).
 * - <ToggleChips>: multiple choice (toggle buttons with aria-pressed inside a labelled group).
 */
import { useId, type ReactNode } from 'react'
import { RadioGroup } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export interface ChoiceOption<T extends string> {
  value: T
  label: ReactNode
  /** Plain-text label for aria/tooltips when `label` is rich. */
  text?: string
  hint?: string
  count?: number | null
}

// Base + exactly one of on/off (no competing utilities: cn() does not merge Tailwind classes).
const chip =
  'inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 md:h-9 disabled:opacity-50'
const chipOff = 'border-divider-strong bg-surface text-ink-2 hover:border-teal hover:text-ink'
const chipOn = 'border-teal bg-glacier text-teal'

/** Result count beside an option; read as ", 12 resorts" by assistive tech. */
function OptionCount({ n }: { n: number }) {
  return (
    <span className="tnum text-[12px] text-ink-3">
      <span className="sr-only">, </span>
      {n}
      <span className="sr-only"> {n === 1 ? 'resort' : 'resorts'}</span>
    </span>
  )
}

export function ChoiceGroup<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  className,
  description,
}: {
  label: string
  hideLabel?: boolean
  options: ChoiceOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  description?: ReactNode
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p id={id} className={hideLabel ? 'sr-only' : 'text-[13.5px] font-medium text-ink'}>
        {label}
      </p>
      {description ? <p className="-mt-1 text-[12.5px] text-ink-3">{description}</p> : null}
      <RadioGroup.Root aria-labelledby={id} value={value} onValueChange={(v) => onChange(v as T)} className="flex flex-wrap gap-2" loop>
        {options.map((o) => (
          <RadioGroup.Item key={o.value} value={o.value} title={o.hint} className={cn(chip, o.value === value ? chipOn : chipOff)}>
            <RadioGroup.Indicator className="-ml-0.5 inline-flex">
              <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
            </RadioGroup.Indicator>
            {o.label}
            {o.count != null ? <OptionCount n={o.count} /> : null}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}

export function ToggleChips<T extends string>({
  label,
  hideLabel = false,
  options,
  values,
  onChange,
  className,
  description,
}: {
  label: string
  hideLabel?: boolean
  options: ChoiceOption<T>[]
  values: readonly T[]
  onChange: (v: T[]) => void
  className?: string
  description?: ReactNode
}) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={cn('flex flex-col gap-2', className)}>
      <p id={id} className={hideLabel ? 'sr-only' : 'text-[13.5px] font-medium text-ink'}>
        {label}
      </p>
      {description ? <p className="-mt-1 text-[12.5px] text-ink-3">{description}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = values.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              title={o.hint}
              onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
              className={cn(chip, on ? chipOn : chipOff)}
            >
              {on ? <Check aria-hidden className="-ml-0.5 size-3.5" strokeWidth={2.4} /> : null}
              {o.label}
              {o.count != null ? <OptionCount n={o.count} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
