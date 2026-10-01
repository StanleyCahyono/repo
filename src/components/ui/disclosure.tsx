/**
 * Disclosure for secondary detail (brief: "keep secondary information behind expansion"). A native
 * <details>/<summary>, so it works without JavaScript, is keyboard-operable, and is announced as expandable; the
 * browser also opens it for find-in-page and when a link targets something inside. One outline chevron (lucide,
 * like every other icon) that turns on open — never the platform's filled triangle.
 *
 * - `link` (default): compact teal trigger for "Details", "All schedules on file (3)".
 * - `row`: full-width trigger for lists and panels, 44px tall on phones.
 */
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export function Disclosure({
  summary,
  children,
  variant = 'link',
  defaultOpen,
  id,
  className,
  summaryClassName,
}: {
  summary: ReactNode
  children: ReactNode
  variant?: 'link' | 'row'
  defaultOpen?: boolean
  id?: string
  className?: string
  summaryClassName?: string
}) {
  return (
    <details id={id} open={defaultOpen} className={cn('group/disclosure', className)}>
      <summary
        className={cn(
          'cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden',
          variant === 'link'
            ? 'inline-flex items-center gap-1 rounded-sm py-0.5 text-[13px] font-medium text-teal hover:underline'
            : 'flex min-h-11 items-center justify-between gap-3 text-[13.5px] font-medium text-ink-2 hover:text-ink md:min-h-9',
          summaryClassName,
        )}
      >
        {variant === 'link' ? (
          <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform duration-150 group-open/disclosure:rotate-90" />
        ) : null}
        <span className="min-w-0">{summary}</span>
        {variant === 'row' ? (
          <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-open/disclosure:rotate-180" />
        ) : null}
      </summary>
      {children}
    </details>
  )
}
