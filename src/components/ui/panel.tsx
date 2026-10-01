import type { ReactNode, HTMLAttributes } from 'react'
import { cn } from '@/lib/ui/cn'

/** Primary content surface: a glass panel (translucent tint, specular top edge, soft lift), 24px radius. */
export function Panel({ className, children, as: Tag = 'section', ...rest }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside' }) {
  return (
    <Tag className={cn('glass min-w-0 rounded-[24px]', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function PanelHeader({
  title,
  eyebrow,
  actions,
  className,
  id,
  level = 2,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  className?: string
  id?: string
  level?: 2 | 3
}) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <header className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <H id={id} className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">
          {title}
        </H>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-divider', className)} />
}

/** Label/value row for fact lists. */
export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', className)}>
      <dt className="min-w-0 text-[13.5px] text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right text-[14.5px] break-words text-ink">{children}</dd>
    </div>
  )
}
