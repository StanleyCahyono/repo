/** Designed empty / error / stale / offline / loading states. */
import type { ReactNode } from 'react'
import { AlertTriangle, CloudOff, Clock3, WifiOff } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { TopoArt } from './topo'

export function EmptyState({
  title,
  body,
  action,
  seed = 'empty',
  className,
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
  seed?: string
  className?: string
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-6 py-8 text-center', className)}>
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <TopoArt seed={seed} density={0.7} />
      </div>
      <div className="relative mx-auto max-w-[46ch]">
        <p className="text-[16px] font-semibold text-ink">{title}</p>
        {body ? <div className="mt-1.5 text-[14px] text-ink-2">{body}</div> : null}
        {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

type Tone = 'error' | 'stale' | 'offline' | 'info'
const toneMap: Record<Tone, { cls: string; Icon: typeof AlertTriangle }> = {
  error: { cls: 'border-critical/40 bg-critical-bg text-ink', Icon: CloudOff },
  stale: { cls: 'border-caution/40 bg-caution-bg text-ink', Icon: Clock3 },
  offline: { cls: 'border-divider-strong bg-surface-3 text-ink', Icon: WifiOff },
  info: { cls: 'border-info/30 bg-info-bg text-ink', Icon: AlertTriangle },
}

/** Inline notice for fetch failures, stale data and offline viewing. */
export function Notice({ tone = 'info', title, children, action, className }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, Icon } = toneMap[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-[10px] border px-4 py-3', cls, className)}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-critical' : tone === 'stale' ? 'text-caution' : 'text-ink-2')} />
      <div className="min-w-0 flex-1 text-[13.5px]">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-ink-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-3', className)} />
}
