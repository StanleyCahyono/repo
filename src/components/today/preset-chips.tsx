'use client'
/**
 * Preset selector for "Where to ski" — what kind of day to rank for. Radio group with arrow keys and a gliding
 * highlight; each chip's title lists the factor weights it applies, so the choice is never a black box.
 */
import type { KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { t } from '@/lib/ui/motion'
import type { RecommendPreset } from '@/lib/domain/recommend'
import { useTodayNav } from './nav'

const SHORT: Record<RecommendPreset, string> = {
  learning: 'Learning day',
  'best-snow': 'Best snow',
  'lowest-cost': 'Lowest cost',
  'short-drive': 'Short drive',
  'apres-weekend': 'Après weekend',
  custom: 'My weights',
}

export interface PresetOption {
  id: RecommendPreset
  label: string
  /** "Fit 45% · Conditions 25% · …" */
  weights: string
}

export function PresetChips({ presets, fallback, className }: { presets: PresetOption[]; fallback: RecommendPreset; className?: string }) {
  const { params, navigate } = useTodayNav()
  const current = params.preset ?? fallback
  const choose = (id: RecommendPreset) => navigate({ preset: id === fallback ? null : id })
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = presets.findIndex((p) => p.id === current)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = presets[(i + step + presets.length) % presets.length]
    choose(next.id)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-preset="${next.id}"]`)?.focus()
  }
  return (
    <ScrollRow className={cn('-mx-4 px-4 pb-0.5 scrollbar-thin md:mx-0 md:px-0', className)}>
      <div role="radiogroup" aria-label="Rank for" onKeyDown={onKey} className="flex w-max items-center gap-1.5 xl:w-auto xl:flex-wrap">
        {presets.map((p) => {
          const on = p.id === current
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-preset={p.id}
              tabIndex={on ? 0 : -1}
              title={`${p.label}: ${p.weights}`}
              onClick={() => choose(p.id)}
              className={cn(
                'relative inline-flex h-11 shrink-0 items-center rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 md:h-9',
                on ? 'text-on-teal' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )}
            >
              {on ? <motion.span layoutId="today-preset" transition={t.select} aria-hidden className="absolute inset-0 rounded-full bg-teal" /> : null}
              <span className="relative">{SHORT[p.id]}</span>
              <span className="sr-only">, weights: {p.weights}</span>
            </button>
          )
        })}
      </div>
    </ScrollRow>
  )
}
