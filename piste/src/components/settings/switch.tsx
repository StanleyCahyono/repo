'use client'
/**
 * On/off switch (role="switch") with a visible text state beside it, so colour is never the only cue.
 * The thumb glides (transform only) and respects reduced motion through the shell's MotionConfig.
 */
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

export function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled,
  onText = 'On',
  offText = 'Off',
  showState = true,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible name when no visible label is associated (via labelledBy). */
  label?: string
  labelledBy?: string
  describedBy?: string
  disabled?: boolean
  onText?: string
  offText?: string
  showState?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group inline-flex min-h-11 items-center gap-2.5 rounded-md pr-1 text-[13.5px] font-medium text-ink disabled:opacity-50 md:min-h-8',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150',
          checked ? 'border-teal bg-teal' : 'border-divider-strong bg-surface-3 group-hover:border-ink-3',
        )}
      >
        <motion.span
          initial={false}
          animate={{ x: checked ? 17 : 2 }}
          transition={t.hover}
          className={cn('absolute top-[2px] left-0 size-[18px] rounded-full shadow-[0_1px_2px_rgb(12_30_42/0.25)]', checked ? 'bg-on-teal' : 'bg-surface')}
        />
      </span>
      {showState ? <span className={checked ? 'text-ink' : 'text-ink-2'}>{checked ? onText : offText}</span> : null}
    </button>
  )
}
