'use client'
/** Segmented single-choice control (radiogroup semantics) with a gliding selection highlight. */
import { useId } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  hint?: string
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
  hideLabel = true,
}: {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  hideLabel?: boolean
}) {
  const group = useId()
  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <span id={group} className={hideLabel ? 'sr-only' : 'text-[12.5px] font-medium text-ink-2'}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={group}
        className="inline-flex rounded-[10px] border border-divider bg-surface-2 p-0.5"
        onKeyDown={(e) => {
          const i = options.findIndex((o) => o.value === value)
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(options[(i + 1) % options.length].value)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(options[(i - 1 + options.length) % options.length].value)
          }
        }}
      >
        {options.map((o) => {
          const selected = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={o.hint}
              onClick={() => onChange(o.value)}
              className={cn(
                'relative rounded-[8px] font-medium whitespace-nowrap transition-colors duration-150',
                size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]',
                selected ? 'text-teal' : 'text-ink-2 hover:text-ink',
              )}
            >
              {selected ? (
                <motion.span layoutId={`seg-${group}`} transition={t.select} className="absolute inset-0 rounded-[8px] border border-divider bg-surface shadow-[0_1px_2px_rgb(12_30_42/0.08)]" aria-hidden />
              ) : null}
              <span className="relative">{o.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
