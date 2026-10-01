import { CircleCheck, CircleDashed, CircleSlash, CircleHelp, CirclePause, CircleDot, Hourglass } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { OPERATING_STATUS_LABEL, type OperatingStatus, type OpeningLabel } from '@/lib/domain/types'

const statusStyle: Record<OperatingStatus, { cls: string; Icon: typeof CircleCheck }> = {
  open: { cls: 'bg-positive-bg text-positive', Icon: CircleCheck },
  'partially-open': { cls: 'bg-positive-bg text-positive', Icon: CircleDot },
  'not-yet-open': { cls: 'bg-chip-track text-ink-2', Icon: Hourglass },
  'temporarily-closed': { cls: 'bg-caution-bg text-caution', Icon: CirclePause },
  'closed-for-season': { cls: 'bg-critical-bg text-critical', Icon: CircleSlash },
  unknown: { cls: 'bg-chip-track text-ink-2 border border-dashed border-divider-strong', Icon: CircleHelp },
}

/** Operating status with icon + text (never colour alone). */
export function StatusPill({ status, className, size = 'md' }: { status: OperatingStatus; className?: string; size?: 'sm' | 'md' }) {
  const { cls, Icon } = statusStyle[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]',
        cls,
        className,
      )}
    >
      <Icon aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={2} />
      {OPERATING_STATUS_LABEL[status]}
    </span>
  )
}

const openingStyle: Record<OpeningLabel, { text: string; cls: string }> = {
  announced: { text: 'Announced', cls: 'text-teal border-teal/60' },
  estimated: { text: 'Estimated', cls: 'text-caution border-caution/60 border-dashed' },
  opened: { text: 'Opened', cls: 'text-positive border-positive/60' },
  'not-announced': { text: 'Not announced', cls: 'text-ink-2 border-divider-strong border-dashed' },
}

/** Label distinguishing announced targets from estimates and actual openings. */
export function OpeningTag({ label, className }: { label: OpeningLabel; className?: string }) {
  const s = openingStyle[label]
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center rounded-[7px] border px-1.5 text-[12px] leading-none font-medium whitespace-nowrap', s.cls, className)}>
      {s.text}
    </span>
  )
}

export { CircleDashed }
