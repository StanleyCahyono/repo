'use client'
/**
 * Entrance motion for the first few blocks of the page: 220ms fade + 8px rise (docs/design.md). Collapses under
 * reduced motion via the shell's <MotionConfig reducedMotion="user">. Only use on the first ~4 items.
 * The page renders <RevealNoScript/> so the content is never left invisible when JavaScript does not run.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { rise, t } from '@/lib/ui/motion'

const tags = { div: motion.div, header: motion.header, section: motion.section, aside: motion.aside } as const

export function Reveal({
  as = 'div',
  delay = 0,
  className,
  id,
  children,
}: {
  as?: keyof typeof tags
  delay?: number
  className?: string
  id?: string
  children: ReactNode
}) {
  const Tag = tags[as]
  return (
    <Tag id={id} data-reveal className={className} variants={rise} initial="hidden" animate="show" transition={{ ...t.pageIn, delay }}>
      {children}
    </Tag>
  )
}

/** Without JavaScript the entrance never runs: show revealed blocks as they are. */
export function RevealNoScript() {
  return (
    <noscript>
      <style>{'[data-reveal]{opacity:1!important;transform:none!important}'}</style>
    </noscript>
  )
}
