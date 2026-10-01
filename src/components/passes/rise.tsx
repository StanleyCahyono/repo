'use client'
/**
 * Entrance for the first few blocks of a Passes & Costs page: 220 ms fade + 8 px rise (docs/design.md), staggered by
 * `index` (capped at 3). Collapses under reduced motion via the shell's MotionConfig.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { rise, t } from '@/lib/ui/motion'

export function Rise({ index = 0, className, children, as = 'div' }: { index?: number; className?: string; children: ReactNode; as?: 'div' | 'li' | 'section' | 'aside' }) {
  const M = as === 'li' ? motion.li : as === 'section' ? motion.section : as === 'aside' ? motion.aside : motion.div
  return (
    <M variants={rise} initial="hidden" animate="show" transition={{ ...t.pageIn, delay: Math.min(index, 3) * 0.045 }} className={className}>
      {children}
    </M>
  )
}

/** A bar that grows from its start once (300–450 ms), e.g. day allowances and cost bars. */
export function GrowBar({ className, pct, delay = 0 }: { className?: string; pct: number; delay?: number }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <motion.span
      aria-hidden
      className={className}
      style={{ width: `${w}%`, transformOrigin: 'left center' }}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ ...t.bars, delay }}
    />
  )
}
