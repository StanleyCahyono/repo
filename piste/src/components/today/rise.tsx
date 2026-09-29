'use client'
/**
 * Entrance for the first few Today blocks: 220 ms fade + 8 px rise (docs/design.md), staggered by `index` and capped
 * at the fourth block. Collapses under reduced motion via the shell's MotionConfig. No scroll-linked motion.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { t } from '@/lib/ui/motion'

export function Rise({
  index = 0,
  className,
  children,
  as = 'div',
}: {
  index?: number
  className?: string
  children: ReactNode
  as?: 'div' | 'section' | 'aside'
}) {
  const M = as === 'section' ? motion.section : as === 'aside' ? motion.aside : motion.div
  return (
    <M initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...t.pageIn, delay: Math.min(index, 3) * 0.05 }} className={className}>
      {children}
    </M>
  )
}
