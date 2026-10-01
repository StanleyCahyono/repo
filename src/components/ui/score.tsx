'use client'
/**
 * Conditions score display. Designed states: complete score, limited data, weather potential, closed, none.
 * Scores describe suitability, not safety. Colour is never the only cue — every state carries text.
 */
import { motion } from 'motion/react'
import { Ban, CircleHelp, Gauge, CloudSun } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import type { ComponentResult } from '@/lib/db/schema'
import { COMPONENT_LABEL, type Confidence, type ScoreKind } from '@/lib/domain/types'

export function descriptorFor(score: number | null): string | null {
  if (score === null) return null
  if (score >= 85) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 55) return 'Mixed'
  return 'Challenging'
}

function toneFor(score: number | null) {
  if (score === null) return 'text-ink-2'
  if (score >= 70) return 'text-positive'
  if (score >= 55) return 'text-caution'
  return 'text-critical'
}

export function ConfidenceTag({ confidence, className }: { confidence: Confidence; className?: string }) {
  const bars = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-ink-2', className)} title="Evidence confidence — a qualitative label, not a probability">
      <span aria-hidden className="inline-flex items-end gap-[2px]">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-[3px] rounded-[1px]', i <= bars ? 'bg-ink-2' : 'bg-divider-strong')} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </span>
  )
}

export interface ScoreProps {
  scoreKind: ScoreKind
  score: number | null
  coverage?: number | null
  confidence?: Confidence | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Compact score for cards and lists. */
export function ScoreChip({ scoreKind, score, coverage, size = 'md', className }: ScoreProps) {
  const big = size === 'lg' ? 'text-[44px]' : size === 'md' ? 'text-[30px]' : 'text-[22px]'
  if (scoreKind === 'closed') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-medium text-critical', className)}>
        <Ban aria-hidden className="size-4" /> Closed
      </span>
    )
  }
  if (scoreKind === 'none' || score === null) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-ink-3 italic', className)}>
        <CircleHelp aria-hidden className="size-4 not-italic" /> {scoreKind === 'limited' ? 'Limited data' : 'No score yet'}
      </span>
    )
  }
  const label =
    scoreKind === 'limited' ? 'Limited data' : scoreKind === 'weather-potential' ? 'Weather potential' : descriptorFor(score)
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span className={cn('font-display tnum leading-none font-light tracking-[-0.03em]', big, scoreKind === 'conditions' ? toneFor(score) : 'text-ink-2')}>
        {score}
        {scoreKind !== 'conditions' ? <span className="align-top text-[0.45em]">*</span> : null}
      </span>
      <span className="flex flex-col text-[12px] leading-tight">
        <span className="font-semibold text-ink">{label}</span>
        {scoreKind === 'limited' && typeof coverage === 'number' ? (
          <span className="text-ink-3">{Math.round(coverage * 100)}% inputs</span>
        ) : scoreKind === 'weather-potential' ? (
          <span className="inline-flex items-center gap-1 text-ink-3">
            <CloudSun aria-hidden className="size-3" /> weather only
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-ink-3">
            <Gauge aria-hidden className="size-3" /> of 100
          </span>
        )}
      </span>
    </span>
  )
}

/** Factor breakdown with a one-time bar reveal. */
export function ScoreBreakdown({ components, className }: { components: ComponentResult[]; className?: string }) {
  const totalWeight = components.filter((c) => c.included).reduce((s, c) => s + c.weight, 0)
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ul className="flex flex-col gap-2.5">
        {components.map((c) => (
          <li key={c.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="text-[13.5px] text-ink">
              <span className="font-mono text-[12px] text-ink-3">{c.key}</span> {COMPONENT_LABEL[c.key]}
              <span className="ml-1.5 text-[12px] text-ink-3">
                {c.included ? `weight ${Math.round((c.weight / (totalWeight || 1)) * 100)}%` : 'excluded — no data'}
              </span>
            </span>
            <span className="tnum text-right text-[14px] font-semibold text-ink">{c.value === null ? '—' : Math.round(c.value)}</span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              {c.value !== null ? (
                <motion.span
                  className={cn('block h-full rounded-full', c.included ? 'bg-teal' : 'bg-divider-strong')}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: Math.max(0.02, c.value / 100) }}
                  transition={t.bars}
                  style={{ originX: 0 }}
                />
              ) : null}
            </span>
            {c.note || c.proxy ? (
              <span className="col-span-2 text-[12.5px] text-ink-2">
                {c.note}
                {c.proxy ? <em className="ml-1 text-ink-3">Proxy: {c.proxy}</em> : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Score components</caption>
        <thead>
          <tr>
            <th>Component</th>
            <th>Value</th>
            <th>Weight</th>
            <th>Included</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.key}>
              <td>{COMPONENT_LABEL[c.key]}</td>
              <td>{c.value ?? 'no data'}</td>
              <td>{c.weight}</td>
              <td>{c.included ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
