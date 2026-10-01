/**
 * Entrance: 8px rise + fade (220ms), staggered by `index` for the first four blocks; later ones render at once.
 * Pure CSS (`.piste-rise` in globals.css) so server-rendered content is never invisible while the page hydrates;
 * collapses under reduced motion.
 */
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export function Rise({ children, index = 0, className, as: Tag = 'div' }: { children: ReactNode; index?: number; className?: string; as?: 'div' | 'li' | 'section' }) {
  if (index > 3) return <Tag className={className}>{children}</Tag>
  return (
    <Tag className={cn('piste-rise', className)} style={{ '--rise-delay': `${index * 45}ms` } as CSSProperties}>
      {children}
    </Tag>
  )
}
