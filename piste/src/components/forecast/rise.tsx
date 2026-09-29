'use client'
/**
 * Entrance for the first few blocks of the Forecast page: 220 ms fade + 8 px rise (docs/design.md), staggered by
 * `index`. Only use on the first ~4 blocks. Collapses under reduced motion via the shell's MotionConfig.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { rise, t } from '@/lib/ui/motion'

export function Rise({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <motion.div variants={rise} initial="hidden" animate="show" transition={{ ...t.pageIn, delay: Math.min(index, 3) * 0.045 }} className={className}>
      {children}
    </motion.div>
  )
}
