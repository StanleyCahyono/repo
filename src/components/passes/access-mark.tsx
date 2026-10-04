/**
 * Access status mark: icon + text, never colour alone. Unknown access is drawn neutral so it never looks like
 * permission. Server-renderable.
 */
import { cn } from '@/lib/ui/cn'
import { STATUS_META, TONE_CHIP, TONE_TEXT, type MarkStatus } from './format'

export function AccessMark({
  status,
  label,
  variant = 'chip',
  className,
  srSuffix,
}: {
  status: MarkStatus
  /** Overrides the default label (e.g. a verdict headline "Included — 1 day left"). */
  label?: string
  variant?: 'chip' | 'inline' | 'cell'
  className?: string
  /** Extra text for screen readers only. */
  srSuffix?: string
}) {
  const m = STATUS_META[status]
  const text = label ?? (variant === 'cell' ? m.short : m.label)
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-medium', TONE_TEXT[m.tone], className)}>
        <m.Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        <span>{text}</span>
        {srSuffix ? <span className="sr-only">{srSuffix}</span> : null}
      </span>
    )
  }
  if (variant === 'cell') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap', TONE_TEXT[m.tone], className)}>
        <m.Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
        <span>{text}</span>
        {srSuffix ? <span className="sr-only">{srSuffix}</span> : null}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium whitespace-nowrap', TONE_CHIP[m.tone], className)}>
      <m.Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} />
      <span>{text}</span>
      {srSuffix ? <span className="sr-only">{srSuffix}</span> : null}
    </span>
  )
}
