'use client'
/**
 * Segmented single-choice control (radiogroup semantics, roving tabindex, arrow keys). Glass HUD: a translucent pill
 * track with a dark HUD chip that slides to the selection (shared layoutId, 200ms; instant under reduced motion).
 * Never forces horizontal page scroll: a long row scrolls inside its own track, or pass `wrap` to wrap it.
 */
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
  wrap = false,
}: {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  hideLabel?: boolean
  /** Let the segments wrap onto more rows (many options on a narrow screen). */
  wrap?: boolean
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
        className={cn(
          'max-w-full gap-0.5 border border-glass-line bg-chip-track p-1',
          wrap ? 'flex flex-wrap rounded-[20px]' : 'inline-flex overflow-x-auto rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
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
                'relative shrink-0 rounded-full font-medium whitespace-nowrap transition-colors duration-150',
                size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[14px]',
                selected ? 'text-on-ink-chip' : 'text-ink hover:bg-chip-hover',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId={`seg-${group}`}
                  transition={t.select}
                  className="absolute inset-0 rounded-full bg-ink-chip shadow-[0_4px_12px_-4px_rgb(19_32_44/0.45)]"
                  aria-hidden
                />
              ) : null}
              <span className="relative">{o.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
