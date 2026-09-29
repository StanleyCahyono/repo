/**
 * One visual vocabulary for Sources & Sync: refresh states, connector health/setup and coverage states, each with
 * an icon AND a text label (colour is never the only cue). Nothing that failed, never ran, needs credentials or is
 * simulated ever gets the positive "working" treatment.
 */
import type { ReactNode } from 'react'
import {
  BadgeCheck,
  BookMarked,
  Calculator,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock3,
  CloudOff,
  FileWarning,
  FlaskConical,
  Hand,
  KeyRound,
  LoaderCircle,
  Minus,
  PenLine,
  Plug,
  Radio,
  SearchCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ConnectorHealth, CoverageState, RefreshState } from '@/lib/data/sources'
import { cn } from '@/lib/ui/cn'

export type Tone = 'positive' | 'caution' | 'critical' | 'info' | 'neutral' | 'demo' | 'teal' | 'copper'

const TONE_CHIP: Record<Tone, string> = {
  positive: 'bg-positive-bg text-positive',
  caution: 'bg-caution-bg text-caution',
  critical: 'bg-critical-bg text-critical',
  info: 'bg-info-bg text-info',
  neutral: 'bg-surface-3 text-ink-2',
  demo: 'bg-demo-bg text-demo',
  teal: 'bg-glacier text-teal',
  copper: 'bg-surface-3 text-copper',
}

export const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
  info: 'text-info',
  neutral: 'text-ink-2',
  demo: 'text-demo',
  teal: 'text-teal',
  copper: 'text-copper',
}

export interface StateSpec {
  label: string
  tone: Tone
  Icon: LucideIcon
}

export const REFRESH_STATE: Record<RefreshState, StateSpec> = {
  ok: { label: 'Up to date', tone: 'positive', Icon: CircleCheck },
  partial: { label: 'Partly failing', tone: 'caution', Icon: TriangleAlert },
  failing: { label: 'Failing', tone: 'critical', Icon: CloudOff },
  stale: { label: 'Stale', tone: 'caution', Icon: Clock3 },
  'nothing-fetched': { label: 'Fetched nothing', tone: 'caution', Icon: CircleDashed },
  'never-succeeded': { label: 'Never succeeded', tone: 'critical', Icon: CloudOff },
  'never-run': { label: 'Never run', tone: 'neutral', Icon: CircleDashed },
  running: { label: 'Running', tone: 'info', Icon: LoaderCircle },
  demo: { label: 'Demo — not refreshed', tone: 'demo', Icon: FlaskConical },
}

export const CONNECTOR_HEALTH: Record<ConnectorHealth, StateSpec> = {
  ok: { label: 'Working', tone: 'positive', Icon: CircleCheck },
  stale: { label: 'Stale', tone: 'caution', Icon: Clock3 },
  failing: { label: 'Failing', tone: 'critical', Icon: CloudOff },
  'never-succeeded': { label: 'No successful fetch yet', tone: 'caution', Icon: CircleDashed },
  'not-configured': { label: 'Not configured', tone: 'neutral', Icon: KeyRound },
  disabled: { label: 'Turned off', tone: 'neutral', Icon: CircleSlash },
  'on-demand': { label: 'On demand only', tone: 'info', Icon: Hand },
  demo: { label: 'Demo — not fetched', tone: 'demo', Icon: FlaskConical },
}

/** Setup state from providerStatus(): configuration and maturity only — never evidence that anything works. */
export const CONNECTOR_SETUP: Record<'live' | 'needs-credentials' | 'unverified' | 'disabled' | 'manual', StateSpec & { hint: string }> = {
  live: { label: 'Documented API', tone: 'neutral', Icon: Plug, hint: 'Implemented against a documented API; no further setup needed.' },
  'needs-credentials': { label: 'Needs credentials', tone: 'caution', Icon: KeyRound, hint: 'Optional connector; its credential is not set, so nothing is called.' },
  unverified: { label: 'Unverified parser', tone: 'caution', Icon: FileWarning, hint: 'Written without access to the live page; expect “layout not recognised” until verified.' },
  disabled: { label: 'Disabled', tone: 'neutral', Icon: CircleSlash, hint: 'Turned off with PISTE_DISABLED_PROVIDERS; refresh jobs never call it.' },
  manual: { label: 'Manual', tone: 'neutral', Icon: PenLine, hint: 'No automated source: you enter it from the official page, with a source link.' },
}

export const COVERAGE: Record<CoverageState, StateSpec & { short: string; cell: string }> = {
  live: { label: 'Live', short: 'Live', tone: 'positive', Icon: Radio, cell: 'bg-positive-bg text-positive border-transparent' },
  official: { label: 'Official source', short: 'Official', tone: 'teal', Icon: BadgeCheck, cell: 'bg-glacier text-teal border-transparent' },
  manual: { label: 'Confirmed by you', short: 'Yours', tone: 'neutral', Icon: PenLine, cell: 'bg-surface-3 text-ink border-transparent' },
  derived: { label: 'Piste estimate', short: 'Estimate', tone: 'copper', Icon: Calculator, cell: 'bg-surface-2 text-copper border-copper/40' },
  researched: { label: 'Researched — confirm at source', short: 'Researched', tone: 'caution', Icon: SearchCheck, cell: 'bg-caution-bg text-caution border-transparent' },
  reference: { label: 'Reference data — confirm at source', short: 'Reference', tone: 'neutral', Icon: BookMarked, cell: 'bg-surface-2 text-ink-2 border-divider-strong border-dashed' },
  stale: { label: 'Stale', short: 'Stale', tone: 'caution', Icon: Clock3, cell: 'bg-caution-bg text-caution border-caution/50' },
  failing: { label: 'Refresh failing', short: 'Failing', tone: 'critical', Icon: CloudOff, cell: 'bg-critical-bg text-critical border-transparent' },
  missing: { label: 'Missing', short: 'Missing', tone: 'neutral', Icon: Minus, cell: 'bg-transparent text-ink-3 border-divider-strong border-dashed' },
  demo: { label: 'Demo data', short: 'Demo', tone: 'demo', Icon: FlaskConical, cell: 'bg-demo-bg text-demo border-transparent' },
}

/** Order used by legends and counts: strongest evidence first, problems last. */
export const COVERAGE_ORDER: CoverageState[] = ['live', 'official', 'manual', 'derived', 'researched', 'reference', 'stale', 'failing', 'missing', 'demo']

export function StateChip({ spec, children, className, spin }: { spec: StateSpec; children?: ReactNode; className?: string; spin?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-[12.5px] leading-none font-medium whitespace-nowrap', TONE_CHIP[spec.tone], className)}>
      <spec.Icon aria-hidden className={cn('size-3.5 shrink-0', spin && 'animate-spin')} strokeWidth={2} />
      {children ?? spec.label}
    </span>
  )
}

