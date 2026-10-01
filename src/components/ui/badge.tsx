import type { ReactNode } from 'react'
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { PassFamilyId } from '@/lib/domain/types'

type Tone = 'neutral' | 'teal' | 'positive' | 'caution' | 'critical' | 'info' | 'demo' | 'copper'

const tones: Record<Tone, string> = {
  neutral: 'bg-chip-track text-ink-2 border-glass-line',
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
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-[8px] border px-2 text-[12px] font-medium leading-none whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden className="-ml-0.5 inline-flex [&>svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  )
}

/**
 * The one demo-mode label for page and resort headers (flask icon + text, demo tone). Sits inside an `eyebrow`, so it
 * resets the eyebrow's uppercase tracking. Pass `children` to say what demo means on that page.
 */
export function DemoBadge({ children = 'Demo data', className }: { children?: ReactNode; className?: string }) {
  return (
    <Badge tone="demo" icon={<FlaskConical strokeWidth={2} />} className={cn('h-auto min-h-6 py-1 leading-tight tracking-normal whitespace-normal normal-case', className)}>
      {children}
    </Badge>
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-[22px] px-1.5 text-[12px]' : 'h-6 px-2 text-[12px]',
        passTones[family],
        className,
      )}
    >
      <span aria-hidden className="font-mono text-[10px] font-semibold tracking-wider opacity-80">
        {passMarks[family]}
      </span>
      <span>{PASS_FAMILY_LABEL[family]}</span>
      {detail ? <span className="font-normal opacity-85">· {detail}</span> : null}
    </span>
  )
}
