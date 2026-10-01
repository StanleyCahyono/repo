/**
 * Entrance for the first few sections of Settings and Sources & Sync: 220 ms fade + 8 px rise (docs/design.md),
 * staggered by `index` (only the first ~4 animate). Pure CSS (`.piste-rise`), so the content is never left
 * invisible while a long page hydrates, and it works without JavaScript; collapses under reduced motion.
 */
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function Rise({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  if (index > 3) return <div className={className}>{children}</div>
  return (
    <div className={cn('piste-rise', className)} style={{ '--rise-delay': `${index * 45}ms` } as CSSProperties}>
      {children}
    </div>
  )
}
