'use client'
/**
 * A horizontally scrolling row (tabs, chips) that fades whichever edge has more content past it, so a cut-off
 * label reads as "scroll for more" instead of looking broken. See useScrollEdges and `.scroll-fade-x`.
 */
import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import { useScrollEdges } from '@/lib/ui/use-scroll-edges'

export function ScrollRow({
  as = 'div',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'nav' | 'ul'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement & HTMLUListElement>(null)
  useScrollEdges(ref)
  const cls = cn('scroll-fade-x overflow-x-auto', className)
  if (as === 'nav') {
    return (
      <nav ref={ref} className={cls} {...rest}>
        {children}
      </nav>
    )
  }
  if (as === 'ul') {
    return (
      <ul ref={ref} className={cls} {...rest}>
        {children}
      </ul>
    )
  }
  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  )
}
