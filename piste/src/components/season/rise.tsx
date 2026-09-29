'use client'
/** Entrance: 8px rise + fade (220ms). `index` staggers only the first four blocks; later ones render at once. */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { t } from '@/lib/ui/motion'

export function Rise({ children, index = 0, className, as = 'div' }: { children: ReactNode; index?: number; className?: string; as?: 'div' | 'li' | 'section' }) {
  if (index > 3) return as === 'li' ? <li className={className}>{children}</li> : as === 'section' ? <section className={className}>{children}</section> : <div className={className}>{children}</div>
  const Comp = as === 'li' ? motion.li : as === 'section' ? motion.section : motion.div
  return (
    <Comp className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...t.pageIn, delay: index * 0.045 }}>
      {children}
    </Comp>
  )
}
