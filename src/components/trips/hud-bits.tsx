'use client'
/**
 * Small animated HUD pieces for the Trips screens: a bar that grows once into view, and a progress ring that
 * sweeps to its value. Both are decoration beside the numbers they show (aria-hidden); transform/opacity only, and
 * they settle instantly under reduced motion (MotionConfig in the shell).
 */
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'

/** Two-step bar: a solid low end and a lighter step up to the high end of a range (fractions 0–1). */
export function GrowBar({ low, high = low, delay = 0, className, tone = 'teal' }: { low: number; high?: number; delay?: number; className?: string; tone?: 'teal' | 'ink' }) {
  const solid = tone === 'ink' ? 'bg-ink-chip' : 'bg-teal'
  const light = tone === 'ink' ? 'bg-ink-chip/30' : 'bg-teal/30'
  return (
    // The track observes the viewport (a scaled-to-zero bar has no area for the observer to see).
    <motion.span aria-hidden initial="hidden" whileInView="show" viewport={{ once: true }} className={cn('relative block h-1.5 overflow-hidden rounded-full bg-ink/[0.07]', className)}>
      {high > low ? (
        <motion.span
          className={cn('absolute inset-y-0 left-0 rounded-full', light)}
          style={{ width: `${Math.min(1, high) * 100}%`, originX: 0 }}
          variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { ...t.bars, delay } } }}
        />
      ) : null}
      <motion.span
        className={cn('absolute inset-y-0 left-0 rounded-full', solid)}
        style={{ width: `${Math.min(1, low) * 100}%`, originX: 0 }}
        variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { type: 'spring', stiffness: 160, damping: 22, delay } } }}
      />
    </motion.span>
  )
}

/** Progress ring (0–1) with the value text in the middle. */
export function Ring({ value, size = 56, children, tone = 'teal', className }: { value: number; size?: number; children?: React.ReactNode; tone?: 'teal' | 'positive' | 'copper'; className?: string }) {
  const r = 15.5
  const stroke = tone === 'positive' ? 'var(--positive)' : tone === 'copper' ? 'var(--copper)' : 'var(--teal)'
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--ink)" strokeOpacity={0.08} strokeWidth={3} />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: Math.max(0, Math.min(1, value)) }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 90, damping: 18 }}
        />
      </svg>
      <span className="relative text-[13px] font-semibold text-ink tnum">{children}</span>
    </span>
  )
}
