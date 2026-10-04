'use client'
/**
 * Section entrance on scroll (8–12px rise + fade, 220ms) that never hides server-rendered content: the block renders
 * in place on the server and the first client paint; only a block still below the fold after hydration is armed, then
 * rises when it scrolls into view. Already-visible blocks and reduced motion just stay put. Used by My Season,
 * Settings and Sources & Sync for the sections below the first screen (the first ones use the CSS `Rise`).
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { t } from '@/lib/ui/motion'
import { useReveal } from './reveal'

export function ScrollRise({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  const [ref, phase] = useReveal<HTMLDivElement>('-40px')
  return (
    <motion.div
      ref={ref}
      id={id}
      className={className}
      initial={false}
      animate={phase === 'armed' ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
      transition={phase === 'armed' ? { duration: 0 } : t.pageIn}
    >
      {children}
    </motion.div>
  )
}
