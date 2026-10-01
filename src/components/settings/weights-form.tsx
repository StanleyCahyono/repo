'use client'
/**
 * Recommendation weights for the weekend finder's “My weights” ranking. Weights are relative: the bar shows each
 * factor's share of the ranking. Presets copy a built-in mix into the form (nothing is saved until you save).
 */
import { motion } from 'motion/react'
import { saveWeights } from '@/lib/actions/settings'
import type { RecommendationWeights } from '@/lib/db/schema'
import { FACTOR_KEYS, FACTOR_LABEL, PRESET_LABEL, PRESET_WEIGHTS, type FactorKey } from '@/lib/domain/recommend'
import { Select } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { SaveBar } from './save-bar'
import { SettingsPanel } from './section'
import { useSave } from './use-save'
import { errorFor, useDraft } from './use-draft'

const HINT: Record<FactorKey, string> = {
  conditions: 'Piste Conditions for the day — surface, snow, weather and open terrain.',
  fit: 'How the terrain suits your ability and day lens.',
  travel: 'Drive time with the winter buffer, or a fly-in trip.',
  cost: 'Estimated total for the day against your budget.',
  events: 'Festivals, races and après on the day.',
}

/** Bar fills per factor — tokens only, distinguishable in both themes; labels always accompany them. */
const FILL: Record<FactorKey, string> = {
  conditions: 'bg-teal',
  fit: 'bg-info',
  travel: 'bg-copper',
  cost: 'bg-positive',
  events: 'bg-caution',
}

type Preset = keyof typeof PRESET_WEIGHTS

export function WeightsForm({ saved }: { saved: RecommendationWeights }) {
  const d = useDraft(saved)
  const { run, pending } = useSave()
  const v = d.values
  const total = FACTOR_KEYS.reduce((a, k) => a + (v[k] ?? 0), 0)
  const share = (k: FactorKey) => (total > 0 ? Math.round(((v[k] ?? 0) / total) * 100) : 0)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const prev = d.baseline
    run(() => saveWeights(v), {
      onDone: (data) => d.commit(data),
      onError: (r) => d.setErrors(r.fieldErrors ?? {}),
      undo: () => run(() => saveWeights(prev), { onDone: (data) => d.commit(data), success: 'Weights restored' }),
    })
  }

  return (
    <SettingsPanel as="form" onSubmit={submit} noValidate aria-label="Recommendation weights">
      <div className="px-4 pt-4 pb-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="weights-share" className="text-[13px] font-medium text-ink-2">
            Share of the ranking
          </p>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="shrink-0 whitespace-nowrap">Start from</span>
            <Select
              value=""
              onChange={(e) => {
                const p = e.target.value as Preset | ''
                if (p) d.set({ ...PRESET_WEIGHTS[p] })
              }}
              className="h-11 max-w-[13rem] md:h-9"
            >
              <option value="">a preset…</option>
              {(Object.keys(PRESET_WEIGHTS) as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div aria-hidden className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
          {FACTOR_KEYS.map((k) =>
            share(k) > 0 ? (
              <motion.span
                key={k}
                className={cn('h-full origin-left border-r-2 border-surface last:border-r-0', FILL[k])}
                style={{ width: `${(v[k] / total) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={t.bars}
              />
            ) : null,
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {total > 0 ? FACTOR_KEYS.map((k) => `${FACTOR_LABEL[k]} ${share(k)} percent`).join(', ') : 'Every weight is zero'}
        </p>
        {total === 0 || errorFor(d.errors, 'conditions') ? (
          <p role="alert" className="mt-2 text-[12.5px] font-medium text-critical">
            {errorFor(d.errors, 'conditions') ?? 'Give at least one factor some weight.'}
          </p>
        ) : null}
      </div>
      <ul className="divide-y divide-divider border-t border-divider">
        {FACTOR_KEYS.map((k) => {
          const id = `weight-${k}`
          return (
            <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem] sm:gap-y-2 md:px-5">
              <div className="min-w-0">
                <label htmlFor={id} className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
                  <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', FILL[k])} />
                  {FACTOR_LABEL[k]}
                </label>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{HINT[k]}</p>
              </div>
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                step={5}
                value={v[k]}
                onChange={(e) => d.set({ [k]: Number(e.target.value) } as Partial<RecommendationWeights>, [k, 'conditions'])}
                aria-valuetext={`${v[k]} — ${share(k)} percent of the ranking`}
                className="order-last col-span-2 h-11 w-full cursor-pointer accent-[var(--teal)] sm:order-none sm:col-span-1 md:h-8"
              />
              <p className="flex flex-col items-end self-start sm:self-center">
                <span className="text-[15px] font-semibold text-ink tnum">{v[k]}</span>
                <span className="text-[12.5px] text-ink-3 tnum">{share(k)} %</span>
              </p>
            </li>
          )
        })}
      </ul>
      <SaveBar
        dirty={d.dirty}
        pending={pending}
        error={Object.keys(d.errors).length ? 'Check the weights' : null}
        onDiscard={d.discard}
        note="Used when the weekend finder ranks with “My weights”. Unknown factors never help a resort win."
      />
    </SettingsPanel>
  )
}
