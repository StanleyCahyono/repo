import { Radio, Satellite, Calculator, PenLine, History, FlaskConical, BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { DataKind } from '@/lib/domain/types'
import { relativeLabel, hoursBetween } from '@/lib/domain/time'

const kinds: Record<DataKind, { label: string; Icon: typeof Radio; cls: string; title: string }> = {
  official: { label: 'Reported', Icon: BadgeCheck, cls: 'text-teal', title: 'Officially reported by the resort, operator or organiser' },
  observed: { label: 'Observed', Icon: Radio, cls: 'text-info', title: 'Instrument observation (weather station)' },
  modeled: { label: 'Model', Icon: Satellite, cls: 'text-ink-2', title: 'Weather-model output — not an observation' },
  derived: { label: 'Piste estimate', Icon: Calculator, cls: 'text-copper', title: 'Calculated by Piste from the inputs shown' },
  manual: { label: 'Manual', Icon: PenLine, cls: 'text-ink-2', title: 'Entered by hand with a source link' },
  historical: { label: 'Historical', Icon: History, cls: 'text-ink-2', title: 'Past-season reference information' },
  demo: { label: 'Demo', Icon: FlaskConical, cls: 'text-demo', title: 'Demonstration data — not live' },
}

/** Small inline tag that says what kind of evidence a value is. */
export function KindTag({ kind, className, compact }: { kind: DataKind; className?: string; compact?: boolean }) {
  const k = kinds[kind]
  return (
    <span title={k.title} className={cn('inline-flex items-center gap-1 text-[12px] font-medium', k.cls, className)}>
      <k.Icon aria-hidden className="size-3.5" strokeWidth={2} />
      {compact ? <span className="sr-only">{k.label}</span> : k.label}
    </span>
  )
}

/**
 * Freshness label. `at` is when the underlying fact was published/observed (or fetched when unknown).
 * Turns caution-coloured when older than `staleHours`.
 */
export function Freshness({
  at,
  now,
  staleHours = 24,
  prefix = 'Updated',
  className,
}: {
  at: string | null | undefined
  now: string
  staleHours?: number
  prefix?: string
  className?: string
}) {
  if (!at) {
    return <span className={cn('text-[12px] text-ink-3', className)}>{prefix}: never</span>
  }
  const stale = hoursBetween(at, now) > staleHours
  return (
    <time
      dateTime={at}
      title={at}
      className={cn('tnum text-[12px]', stale ? 'text-caution font-medium' : 'text-ink-3', className)}
    >
      {prefix} {relativeLabel(at, now)}
      {stale ? ' · stale' : ''}
    </time>
  )
}

/**
 * Explicit missing state. `unknown` = we don't know; `not-offered` = confirmed not offered.
 * Never render 0 or an empty cell for unknown data.
 */
export function Missing({
  kind = 'unknown',
  label,
  className,
}: {
  kind?: 'unknown' | 'not-offered' | 'not-yet' | 'unavailable'
  label?: string
  className?: string
}) {
  const text =
    label ??
    (kind === 'not-offered' ? 'Not offered' : kind === 'not-yet' ? 'Not yet published' : kind === 'unavailable' ? 'Unavailable' : 'Unknown')
  return (
    <span
      className={cn(
        'inline-flex items-center text-[13px]',
        kind === 'not-offered' ? 'text-ink-2' : 'text-ink-3 italic',
        className,
      )}
    >
      {text}
    </span>
  )
}
