'use client'
/**
 * Entrance for the first few sections of Settings and Sources & Sync: 220 ms fade + 8 px rise (docs/design.md),
 * staggered by `index` (only the first ~4 animate). Collapses under reduced motion via the shell's MotionConfig.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { rise, t } from '@/lib/ui/motion'

export function Rise({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  if (index > 3) return <div className={className}>{children}</div>
  return (
    <motion.div variants={rise} initial="hidden" animate="show" transition={{ ...t.pageIn, delay: index * 0.045 }} className={className}>
      {children}
    </motion.div>
  )
}
