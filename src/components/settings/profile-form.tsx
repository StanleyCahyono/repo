'use client'
/** Your ability (a five-step progression), the default day lens, and an optional companion profile. */
import { useId } from 'react'
import { motion } from 'motion/react'
import { saveProfile } from '@/lib/actions/settings'
import { ABILITY_LEVELS, SCORING_MODES, type AbilityLevel, type ScoringMode } from '@/lib/domain/types'
import { Segmented } from '@/components/ui/segmented'
import { Select, TextInput } from '@/components/ui/form'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { ABILITY_TEXT, SCORING_TEXT, TALL } from './options'
import { SaveBar } from './save-bar'
import { FieldError, SettingRow, SettingsPanel } from './section'
import { useSave } from './use-save'
import { errorFor, useDraft } from './use-draft'

export interface ProfileValues {
  ability: AbilityLevel
  scoringMode: ScoringMode
  companionName: string
  companionAbility: AbilityLevel | ''
}

/** Five-step ability picker (radiogroup): a progression, not five unrelated options. */
function AbilityLadder({ value, onChange, labelledBy }: { value: AbilityLevel; onChange: (v: AbilityLevel) => void; labelledBy: string }) {
  const layout = useId()
  const at = ABILITY_LEVELS.indexOf(value)
  return (
    <div>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="grid grid-cols-1 gap-1.5 sm:grid-cols-5 sm:gap-1 sm:rounded-[20px] sm:border sm:border-glass-line sm:bg-chip-track sm:p-1"
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
          if (!step) return
          e.preventDefault()
          const next = ABILITY_LEVELS[(at + step + ABILITY_LEVELS.length) % ABILITY_LEVELS.length]
          onChange(next)
          ;(e.currentTarget.querySelector(`[data-level="${next}"]`) as HTMLElement | null)?.focus()
        }}
      >
        {ABILITY_LEVELS.map((lvl, i) => {
          const on = lvl === value
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-level={lvl}
              onClick={() => onChange(lvl)}
              className={cn(
                'relative flex min-h-11 min-w-0 items-center gap-3 rounded-[16px] border px-3 text-left text-[14px] font-medium transition-colors duration-150 sm:flex-col sm:items-start sm:justify-center sm:gap-1.5 sm:border-0 sm:py-2.5',
                on ? 'border-ink-chip text-on-ink-chip' : 'border-glass-line text-ink-2 hover:bg-chip-hover hover:text-ink max-sm:bg-chip-track',
              )}
            >
              {on ? <motion.span layoutId={`ladder-${layout}`} transition={t.select} aria-hidden className="absolute inset-0 rounded-[16px] bg-ink-chip shadow-[0_6px_16px_-8px_rgb(19_32_44/0.55)]" /> : null}
              <span aria-hidden className="relative flex gap-[3px]">
                {ABILITY_LEVELS.map((_, j) => (
                  <span key={j} className={cn('h-2.5 w-[5px] rounded-[2px]', j <= i ? (on ? 'bg-on-ink-chip' : 'bg-ink-3') : on ? 'bg-on-ink-chip/30' : 'bg-divider-strong')} />
                ))}
              </span>
              <span className="relative min-w-0 truncate">{ABILITY_TEXT[lvl].label}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[13px] text-ink-2" aria-live="polite">
        <span className="font-medium text-ink">{ABILITY_TEXT[value].label}:</span> {ABILITY_TEXT[value].hint}
      </p>
    </div>
  )
}

export function ProfileForm({ saved }: { saved: ProfileValues }) {
  const d = useDraft(saved)
  const { run, pending } = useSave()
  const v = d.values
  const toValues = (x: { ability: AbilityLevel; scoringMode: ScoringMode; companionName: string | null; companionAbility: AbilityLevel | null }): ProfileValues => ({
    ability: x.ability,
    scoringMode: x.scoringMode,
    companionName: x.companionName ?? '',
    companionAbility: x.companionAbility ?? '',
  })
  const toInput = (x: ProfileValues) => ({
    ability: x.ability,
    scoringMode: x.scoringMode,
    companionName: x.companionName.trim() || null,
    companionAbility: x.companionAbility || null,
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const prev = d.baseline
    run(() => saveProfile(toInput(v)), {
      onDone: (data) => d.commit(toValues(data)),
      onError: (r) => d.setErrors(r.fieldErrors ?? {}),
      undo: () => run(() => saveProfile(toInput(prev)), { onDone: (data) => d.commit(toValues(data)), success: 'Ability restored' }),
    })
  }

  const compErr = errorFor(d.errors, 'companionAbility') ?? errorFor(d.errors, 'companionName')

  return (
    <SettingsPanel as="form" onSubmit={submit} noValidate aria-label="Ability and companion">
      <SettingRow label="Your ability" labelId="ability-label" hint="Scores and trail fit use it. Move it up as you progress.">
        <AbilityLadder value={v.ability} onChange={(ability) => d.set({ ability })} labelledBy="ability-label" />
      </SettingRow>
      <SettingRow label="Default day lens" labelId="lens-label" hint="How a day is scored unless you pick another lens on a screen.">
        <Segmented
          label="Default day lens"
          options={SCORING_MODES.map((m) => ({ value: m, label: SCORING_TEXT[m].label.replace(' day', '').replace(' preference', '') }))}
          value={v.scoringMode}
          onChange={(scoringMode) => d.set({ scoringMode })}
          className={TALL}
        />
        <p className="mt-2 text-[13px] text-ink-2">{SCORING_TEXT[v.scoringMode].hint}.</p>
      </SettingRow>
      <SettingRow
        label="Companion"
        labelId="companion-label"
        hint="Optional second skier — for example an advanced friend — so trip comparisons can show how a day suits you both."
      >
        <div role="group" aria-labelledby="companion-label" className="grid max-w-lg gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Name</span>
            <TextInput
              value={v.companionName}
              maxLength={60}
              placeholder="Optional"
              autoComplete="off"
              onChange={(e) => d.set({ companionName: e.target.value }, ['companionName', 'companionAbility'])}
              aria-invalid={!!errorFor(d.errors, 'companionName')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Their ability</span>
            <Select
              value={v.companionAbility}
              onChange={(e) => d.set({ companionAbility: e.target.value as AbilityLevel | '' }, ['companionName', 'companionAbility'])}
              aria-invalid={!!errorFor(d.errors, 'companionAbility')}
              aria-describedby={compErr ? 'companion-err' : undefined}
            >
              <option value="">No companion</option>
              {ABILITY_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {ABILITY_TEXT[l].label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <FieldError id="companion-err" error={compErr} />
        {!v.companionAbility && v.companionName.trim() ? <p className="mt-1.5 text-[12.5px] text-ink-3">Choose their ability to keep the name.</p> : null}
      </SettingRow>
      <SaveBar dirty={d.dirty} pending={pending} error={Object.keys(d.errors).length ? 'Check the highlighted fields' : null} onDiscard={d.discard} />
    </SettingsPanel>
  )
}
