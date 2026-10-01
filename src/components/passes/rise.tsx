/**
 * Entrance for the blocks of a Passes & Costs page: a 260 ms fade + 10 px rise, staggered by `index` (capped at 4).
 * Pure CSS (hud.module.css) so server-rendered content never waits invisible for hydration; reduced motion collapses
 * it (globals.css).
 */
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import css from './hud.module.css'

export function Rise({ index = 0, className, children, as: Tag = 'div' }: { index?: number; className?: string; children: ReactNode; as?: 'div' | 'li' | 'section' | 'aside' }) {
  return (
    <Tag className={cn(css.rise, className)} style={{ '--i': Math.min(index, 4) } as CSSProperties}>
      {children}
    </Tag>
  )
}

/** A bar that grows from its start once, e.g. day allowances and cost bars. */
export function GrowBar({ className, pct, delay = 0 }: { className?: string; pct: number; delay?: number }) {
  const w = Math.max(0, Math.min(100, pct))
  return <span aria-hidden className={cn(css.grow, className)} style={{ width: `${w}%`, animationDelay: `${200 + delay * 1000}ms` }} />
}
