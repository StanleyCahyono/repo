/**
 * Motion presets from the design brief (§9). Animate opacity/transform only; durations in seconds.
 * Components are wrapped in <MotionConfig reducedMotion="user"> so these collapse under reduced motion.
 */
import type { Transition, Variants } from 'motion/react'

export const EASE_OUT: [number, number, number, number] = [0.22, 0.8, 0.26, 1]
export const EASE_IN_OUT: [number, number, number, number] = [0.45, 0, 0.2, 1]

export const t = {
  pageIn: { duration: 0.22, ease: EASE_OUT } satisfies Transition,
  hover: { duration: 0.14, ease: EASE_OUT } satisfies Transition,
  favorite: { duration: 0.16, ease: EASE_OUT } satisfies Transition,
  sheet: { duration: 0.26, ease: EASE_OUT } satisfies Transition,
  select: { duration: 0.2, ease: EASE_OUT } satisfies Transition,
  bars: { duration: 0.38, ease: EASE_OUT } satisfies Transition,
  spring: { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 } satisfies Transition,
}

/** Page/section entrance: 6–10px rise + fade. Stagger only the first few children. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: t.pageIn },
}

/** Parent variant that staggers entrance of its first children; apply `rise` only to the first ~4 items. */
export const stagger = (step = 0.045): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: 0.02 } },
})
