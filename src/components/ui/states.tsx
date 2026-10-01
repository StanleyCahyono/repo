/**
 * Designed empty / error / stale / offline / unknown / loading states (Glass HUD).
 * - EmptyState: a glass panel with faint contours and an optional icon badge — "nothing here yet", never a blank box.
 * - Notice: an inline banner whose tint is opaque (text ≥ 4.5:1), with a tone icon so colour is never the only cue.
 * - Skeleton: a soft breathing block shaped like the content it stands in for (static under reduced motion).
 */
import type { ReactNode } from 'react'
import { AlertTriangle, CloudOff, Clock3, Info, WifiOff } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { TopoArt } from './topo'

export function EmptyState({
  title,
  body,
  action,
  seed = 'empty',
  icon,
  className,
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
  seed?: string
  /** Optional outline icon shown in a small glass badge above the title. */
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('glass-soft relative overflow-hidden rounded-[24px] px-6 py-9 text-center md:py-11', className)}>
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <TopoArt seed={seed} density={0.7} />
      </div>
      <div className="relative mx-auto max-w-[48ch]">
        {icon ? (
          <span aria-hidden className="glass-strong mx-auto mb-3 flex size-11 items-center justify-center rounded-full text-teal [&>svg]:size-5">
            {icon}
          </span>
        ) : null}
        <p className="text-[18px] leading-snug font-semibold tracking-[-0.01em] text-ink">{title}</p>
        {body ? <div className="mt-2 text-[14px] leading-relaxed text-ink-2">{body}</div> : null}
        {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

type Tone = 'error' | 'stale' | 'offline' | 'info'
const toneMap: Record<Tone, { cls: string; icon: string; Icon: typeof AlertTriangle }> = {
  error: { cls: 'border-critical/35 bg-critical-bg', icon: 'bg-critical text-surface', Icon: CloudOff },
  stale: { cls: 'border-caution/35 bg-caution-bg', icon: 'bg-caution text-surface', Icon: Clock3 },
  offline: { cls: 'border-field-edge bg-surface-2', icon: 'bg-ink-chip text-on-ink-chip', Icon: WifiOff },
  info: { cls: 'border-info/30 bg-info-bg', icon: 'bg-info text-surface', Icon: Info },
}

/** Inline notice for fetch failures, stale data and offline viewing. */
export function Notice({ tone = 'info', title, children, action, className }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon, Icon } = toneMap[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-3 rounded-[18px] border px-4 py-3.5 text-ink sm:flex-nowrap', cls, className)}
    >
      <span aria-hidden className={cn('mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full', icon)}>
        <Icon className="size-3.5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 basis-[calc(100%-36px)] text-[13.5px] sm:basis-auto">
        <p className="leading-6 font-semibold">{title}</p>
        {children ? <div className="mt-0.5 leading-relaxed text-ink-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 pl-9 sm:self-center sm:pl-0">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  // Default radius only when the caller sets none (cn() does not merge conflicting Tailwind classes).
  return <div aria-hidden className={cn('piste-skeleton bg-skeleton', !/(^|\s)rounded-/.test(className ?? '') && 'rounded-md', className)} />
}
