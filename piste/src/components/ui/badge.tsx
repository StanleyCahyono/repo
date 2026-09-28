import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import type { PassFamilyId } from '@/lib/domain/types'

type Tone = 'neutral' | 'teal' | 'positive' | 'caution' | 'critical' | 'info' | 'demo' | 'copper'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2 border-divider',
  teal: 'bg-glacier text-teal border-transparent',
  positive: 'bg-positive-bg text-positive border-transparent',
  caution: 'bg-caution-bg text-caution border-transparent',
  critical: 'bg-critical-bg text-critical border-transparent',
  info: 'bg-info-bg text-info border-transparent',
  demo: 'bg-demo-bg text-demo border-transparent',
  copper: 'bg-transparent text-copper border-copper/50',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[12px] font-medium leading-none whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden className="-ml-0.5 inline-flex [&>svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  )
}

export const PASS_FAMILY_LABEL: Record<PassFamilyId, string> = {
  ikon: 'Ikon',
  epic: 'Epic',
  indy: 'Indy',
  'mountain-collective': 'Mountain Collective',
  regional: 'Regional',
}

const passTones: Record<PassFamilyId, string> = {
  ikon: 'bg-ikon-bg text-ikon-ink border-ikon-edge',
  epic: 'bg-epic-bg text-epic-ink border-epic',
  indy: 'bg-indy-bg text-indy-ink border-indy',
  'mountain-collective': 'bg-mc-bg text-mc-ink border-mc',
  regional: 'bg-regional-bg text-regional-ink border-regional',
}

const passMarks: Record<PassFamilyId, string> = {
  ikon: 'IK',
  epic: 'EP',
  indy: 'IN',
  'mountain-collective': 'MC',
  regional: 'RG',
}

/**
 * Pass-family badge: text label + accessible border + a small monogram so colour is never the only cue.
 * These are Piste's own categories — no official logos.
 */
export function PassBadge({
  family,
  detail,
  size = 'md',
  className,
}: {
  family: PassFamilyId
  detail?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[11.5px]' : 'h-6 px-2 text-[12px]',
        passTones[family],
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[9.5px] font-medium tracking-wider opacity-80">
        {passMarks[family]}
      </span>
      <span>{PASS_FAMILY_LABEL[family]}</span>
      {detail ? <span className="font-normal opacity-85">· {detail}</span> : null}
    </span>
  )
}
