'use client'
/**
 * Add / edit one in-app alert rule in a sheet: what it watches, which resort (or all), thresholds in your display
 * units (stored in cm / hours / days / points), and a cooldown so repeated refreshes never repeat an alert.
 */
import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { createAlertRule, updateAlertRule } from '@/lib/actions/settings'
import type { AlertRuleView, ResortChoice } from '@/lib/data/settings-screen'
import type { AlertRuleRow } from '@/lib/db/rows'
import type { AlertType } from '@/lib/db/schema'
import { SCORING_MODES, type ScoringMode, type UnitPrefs } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import { Select, TextInput } from '@/components/ui/form'
import { Sheet } from '@/components/ui/sheet'
import { ALERT_SPECS, ALERT_TYPE_ORDER, modeValue, paramValue, snowFromInput, snowToInput, type ParamSpec } from './alert-specs'
import { SCORING_TEXT } from './options'
import { FieldError } from './section'
import { Switch } from './switch'
import { useSave } from './use-save'

interface Draft {
  type: AlertType
  resortId: string
  params: Record<string, string>
  mode: ScoringMode | ''
  cooldownHours: string
  enabled: boolean
}

function draftFor(type: AlertType, rule: AlertRuleView | null, units: UnitPrefs): Draft {
  const spec = ALERT_SPECS[type]
  const params: Record<string, string> = {}
  for (const p of spec.params) {
    const v = paramValue(rule?.params ?? {}, p)
    params[p.key] = String(p.kind === 'snow' ? snowToInput(v, units) : v)
  }
  return {
    type,
    resortId: rule?.resortId ?? '',
    params,
    mode: rule ? (modeValue(rule.params) ?? '') : '',
    cooldownHours: String(rule?.cooldownHours ?? 12),
    enabled: rule?.enabled ?? true,
  }
}

const UNIT_TEXT = (p: ParamSpec, units: UnitPrefs) => (p.kind === 'days' ? 'days' : p.kind === 'hours' ? 'hours' : p.kind === 'points' ? 'points' : units.snow === 'in' ? 'in' : 'cm')

function rangeText(p: ParamSpec, units: UnitPrefs) {
  if (p.kind !== 'snow') return `${p.min}–${p.max} ${UNIT_TEXT(p, units)}`
  return `${snowToInput(p.min, units)}–${snowToInput(p.max, units)} ${UNIT_TEXT(p, units)}`
}

export function AlertEditor({
  open,
  onOpenChange,
  rule,
  resorts,
  units,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = new rule. */
  rule: AlertRuleView | null
  resorts: ResortChoice[]
  units: UnitPrefs
  onSaved: (row: AlertRuleRow, created: boolean) => void
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? `Edit: ${ALERT_SPECS[rule.type].title}` : 'New alert rule'}
      description="In-app alerts only. Thresholds are in your display units; Piste stores them in metric."
      side="responsive"
      widthClass="md:w-[480px]"
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-0">
            Cancel
          </Button>
          <Button type="submit" form="alert-rule-form" variant="primary" className="min-h-11 md:min-h-0">
            {rule ? 'Save rule' : 'Add rule'}
          </Button>
        </div>
      }
    >
      {open ? <EditorBody key={rule?.id ?? 'new'} rule={rule} resorts={resorts} units={units} onSaved={onSaved} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  )
}

function EditorBody({ rule, resorts, units, onSaved, close }: { rule: AlertRuleView | null; resorts: ResortChoice[]; units: UnitPrefs; onSaved: (row: AlertRuleRow, created: boolean) => void; close: () => void }) {
  const [d, setD] = useState<Draft>(() => draftFor(rule?.type ?? 'snow-threshold', rule, units))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { run, pending } = useSave()
  const spec = ALERT_SPECS[d.type]

  const set = (patch: Partial<Draft>, clear: string[] = []) => {
    setD((x) => ({ ...x, ...patch }))
    if (clear.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params: Record<string, unknown> = {}
    for (const p of spec.params) {
      const raw = d.params[p.key]?.trim().replace(',', '.') ?? ''
      const n = raw === '' ? NaN : Number(raw)
      params[p.key] = p.kind === 'snow' && Number.isFinite(n) ? snowFromInput(n, units) : n
    }
    if (spec.mode && d.mode) params.mode = d.mode
    const cooldown = d.cooldownHours.trim() === '' ? NaN : Number(d.cooldownHours)
    const resortId = spec.resortScope && d.resortId ? d.resortId : null
    const onError = (r: { fieldErrors?: Record<string, string> }) => setErrors(r.fieldErrors ?? {})
    if (rule) {
      run(() => updateAlertRule({ id: rule.id, resortId, params, cooldownHours: cooldown, enabled: d.enabled }), {
        onDone: (row) => {
          onSaved(row, false)
          close()
        },
        onError,
        success: 'Alert rule saved',
      })
    } else {
      run(() => createAlertRule({ type: d.type, resortId, params, cooldownHours: cooldown, enabled: d.enabled }), {
        onDone: (row) => {
          onSaved(row, true)
          close()
        },
        onError,
      })
    }
  }

  const favourites = resorts.filter((r) => r.favorite)
  const others = resorts.filter((r) => !r.favorite)

  return (
    <form id="alert-rule-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
      {!rule ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rule-type" className="text-[13.5px] font-medium text-ink">
            Alert me about
          </label>
          <Select id="rule-type" value={d.type} onChange={(e) => setD(draftFor(e.target.value as AlertType, null, units))}>
            {ALERT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {ALERT_SPECS[t].title}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="rounded-[14px] border border-divider bg-surface-2 px-3.5 py-3 text-[13.5px]">
        <p className="text-ink">{spec.summary}</p>
        {spec.caveat ? <p className="mt-1 text-ink-2">{spec.caveat}</p> : null}
      </div>

      {spec.resortScope ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rule-resort" className="text-[13.5px] font-medium text-ink">
            Resort
          </label>
          <Select id="rule-resort" value={d.resortId} onChange={(e) => set({ resortId: e.target.value }, ['resortId'])} aria-invalid={!!errors.resortId} aria-describedby={errors.resortId ? 'rule-resort-err' : undefined}>
            <option value="">{spec.allScope}</option>
            {favourites.length ? (
              <optgroup label="Favourites">
                {favourites.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All resorts">
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          </Select>
          <FieldError id="rule-resort-err" error={errors.resortId} />
        </div>
      ) : (
        <p className="text-[13.5px] text-ink-2">
          <span className="font-medium text-ink">Covers:</span> {spec.allScope.toLowerCase()}.
        </p>
      )}

      {spec.params.map((p) => {
        const key = `params.${p.key}`
        const id = `rule-${p.key}`
        return (
          <div key={p.key} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
              {p.label}
            </label>
            <div className="flex items-center gap-2">
              <TextInput
                id={id}
                inputMode="decimal"
                value={d.params[p.key] ?? ''}
                onChange={(e) => set({ params: { ...d.params, [p.key]: e.target.value } }, [key])}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `${id}-err` : `${id}-hint`}
                className="max-w-28 tnum"
              />
              <span className="text-[14px] text-ink-2">{UNIT_TEXT(p, units)}</span>
            </div>
            {errors[key] ? <FieldError id={`${id}-err`} error={errors[key]} /> : <p id={`${id}-hint`} className="text-[12.5px] text-ink-3 tnum">{rangeText(p, units)}</p>}
          </div>
        )
      })}

      {spec.mode ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rule-mode" className="text-[13.5px] font-medium text-ink">
            Score it as
          </label>
          <Select id="rule-mode" value={d.mode} onChange={(e) => set({ mode: e.target.value as ScoringMode | '' })}>
            <option value="">Your default day lens</option>
            {SCORING_MODES.map((m) => (
              <option key={m} value={m}>
                {SCORING_TEXT[m].label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="rule-cooldown" className="text-[13.5px] font-medium text-ink">
          Cooldown
        </label>
        <div className="flex items-center gap-2">
          <TextInput
            id="rule-cooldown"
            inputMode="numeric"
            value={d.cooldownHours}
            onChange={(e) => set({ cooldownHours: e.target.value }, ['cooldownHours'])}
            aria-invalid={!!errors.cooldownHours}
            aria-describedby={errors.cooldownHours ? 'rule-cooldown-err' : 'rule-cooldown-hint'}
            className="max-w-24 tnum"
          />
          <span className="text-[14px] text-ink-2">hours</span>
        </div>
        {errors.cooldownHours ? (
          <FieldError id="rule-cooldown-err" error={errors.cooldownHours} />
        ) : (
          <p id="rule-cooldown-hint" className="text-[12.5px] text-ink-3">
            At most one alert per resort (or subject) in this window. The same change never alerts twice.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-divider pt-4">
        <p id="rule-enabled-label" className="text-[13.5px] font-medium text-ink">
          Rule is on
        </p>
        <Switch checked={d.enabled} onChange={(enabled) => set({ enabled })} labelledBy="rule-enabled-label" onText="On" offText="Paused" />
      </div>
      {pending ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Saving…
        </p>
      ) : null}
    </form>
  )
}
