'use client'
/**
 * Small Glass-HUD pieces shared by the Forecast charts: a count-up number, a pill toggle whose white thumb glides
 * between options, the detail line under a chart (fills on hover/focus, like Today's cards) and the glass panel shell.
 * All motion is transform/opacity and collapses under reduced motion (MotionConfig in the shell + useReducedMotion).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

/** A number that counts up from 0 when it mounts or changes. SSR renders the final value. */
export function CountUp({ value, format, duration = 0.9, className }: { value: number; format: (v: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const reduce = useReducedMotion()
  const from = useRef(0)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduce) {
      el.textContent = fmt.current(value)
      from.current = value
      return
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 0.8, 0.26, 1],
      onUpdate: (v) => {
        el.textContent = fmt.current(v)
      },
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration, reduce])
  return (
    <span ref={ref} className={cn('tnum', className)}>
      {format(value)}
    </span>
  )
}

export interface PillOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible label when `label` is short. */
  aria?: string
}

/** Two-to-four option pill toggle (aria-pressed buttons) with a gliding white thumb, as in the mockup's Chart/Table. */
export function PillToggle<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: PillOption<T>[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  const id = useId()
  return (
    <div role="group" aria-label={label} className={cn('inline-flex gap-1 rounded-full bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] p-1', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 md:h-[34px]',
              on ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {on ? (
              <motion.span
                layoutId={`pill-${id}`}
                transition={t.spring}
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface shadow-[0_2px_6px_rgb(19_32_44/0.12)]"
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The chart's detail line: muted hint at rest, a dark chip while a day/hour is hovered, focused or selected. */
export function DetailLine({ active, children, className }: { active: boolean; children: ReactNode; className?: string }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'm-0 min-h-[40px] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-[1.4] transition-colors duration-[250ms]',
        active ? 'bg-ink-chip text-on-ink-chip' : 'bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] text-ink-2',
        className,
      )}
    >
      {children}
    </p>
  )
}

/** Glass panel shell used by every Forecast block. */
export function GlassPanel({
  as: Tag = 'section',
  className,
  children,
  strong,
  ...rest
}: {
  as?: 'section' | 'div' | 'article'
  className?: string
  children: ReactNode
  strong?: boolean
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn(strong ? 'glass-strong' : 'glass', 'rounded-[28px] px-4 py-5 md:rounded-[32px] md:px-6 md:py-6', className)} {...rest}>
      {children}
    </Tag>
  )
}

/** Hatched fill for "less certain" or "no record" areas (token colours only). */
export const HATCH = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink) 9%, transparent) 0 1.5px, transparent 1.5px 6px)'

/**
 * A date as a calendar leaf (mono month over a light day number), in the date picker's language: `selected` is the
 * dark HUD chip, `today` is ringed in teal, `announced` is teal-tinted, `estimate` is dashed copper.
 */
export type LeafTone = 'selected' | 'today' | 'announced' | 'estimate' | 'reported'
const LEAF_TONE: Record<LeafTone, string> = {
  selected: 'bg-ink-chip text-on-ink-chip border-transparent shadow-[0_10px_22px_-12px_rgb(19_32_44/0.6)]',
  reported: 'bg-ink-chip text-on-ink-chip border-transparent shadow-[0_8px_18px_-10px_rgb(19_32_44/0.6)]',
  today: 'bg-surface text-teal border-teal shadow-[inset_0_0_0_1px_var(--teal)]',
  announced: 'bg-[color-mix(in_srgb,var(--teal)_14%,var(--surface))] text-teal border-teal/40',
  estimate: 'bg-surface text-copper border-dashed border-copper',
}
export function DateLeaf({ date, tone, size = 'md', className }: { date: string; tone: LeafTone; size?: 'md' | 'lg'; className?: string }) {
  const [, m, d] = date.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return (
    <motion.span
      key={`${date}-${tone}`}
      aria-hidden
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={t.spring}
      className={cn(
        'flex shrink-0 flex-col items-center border leading-none',
        size === 'lg' ? 'w-[58px] rounded-[16px] py-2' : 'w-[52px] rounded-[14px] py-1.5',
        LEAF_TONE[tone],
        className,
      )}
    >
      <span className="font-mono text-[12px] tracking-[0.08em] uppercase opacity-80">{month}</span>
      <span className={cn('mt-1 font-display font-light tracking-[-0.02em] tnum', size === 'lg' ? 'text-[26px]' : 'text-[22px]')}>{d}</span>
    </motion.span>
  )
}
