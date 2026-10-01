'use client'
/**
 * Add a manual correction to one catalog field (resort_overrides): pick the resort and field, see the value Piste
 * has now, enter the corrected value (or mark it unknown), and say where it comes from — a source link, a note, or
 * both. The server validates it exactly like reading it back (applyOverrides), so a dud value is never stored.
 */
import { useEffect, useState, useTransition } from 'react'
import { LoaderCircle } from 'lucide-react'
import { addCorrection, deleteCorrectionRow, loadCorrectableValues, type CorrectableValues } from '@/lib/actions/sources'
import type { ResortChoice } from '@/lib/data/settings-screen'
import type { UnitPrefs } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import { Checkbox, Select, TextInput, Textarea } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { FieldError } from '@/components/settings/section'
import { useSave } from '@/components/settings/use-save'
import { CORRECTION_FIELDS, CORRECTION_GROUPS, correctionField, formatCorrectionValue, nullable, toInputValue } from './correction-fields'

interface Draft {
  resortId: string
  field: string
  raw: string
  unknown: boolean
  unit: 'ft' | 'm'
  sourceUrl: string
  note: string
}

export function CorrectionSheet({
  open,
  onOpenChange,
  resorts,
  units,
  initialResortId,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resorts: ResortChoice[]
  units: UnitPrefs
  initialResortId?: string | null
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Correct a catalog fact"
      description="Your correction applies everywhere, is labelled “Your correction”, and can be reverted. The catalog value is kept."
      side="responsive"
      widthClass="md:w-[500px]"
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-0">
            Cancel
          </Button>
          <Button type="submit" form="correction-form" variant="primary" className="min-h-11 md:min-h-0">
            Save correction
          </Button>
        </div>
      }
    >
      {open ? <CorrectionBody resorts={resorts} units={units} initialResortId={initialResortId ?? null} close={() => onOpenChange(false)} /> : null}
    </Sheet>
  )
}

function CorrectionBody({ resorts, units, initialResortId, close }: { resorts: ResortChoice[]; units: UnitPrefs; initialResortId: string | null; close: () => void }) {
  const [d, setD] = useState<Draft>({
    resortId: initialResortId ?? resorts[0]?.id ?? '',
    field: 'season.announcedOpening',
    raw: '',
    unknown: false,
    unit: units.elevation,
    sourceUrl: '',
    note: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [values, setValues] = useState<CorrectableValues | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const { run, pending } = useSave()
  const spec = correctionField(d.field)!
  const current = values && values.resortId === d.resortId ? values.current[d.field] : undefined

  // Current values for the chosen resort (read-only server action).
  useEffect(() => {
    if (!d.resortId) return
    let cancelled = false
    startLoading(async () => {
      try {
        const r = await loadCorrectableValues({ resortId: d.resortId })
        if (cancelled) return
        if (r.ok) {
          const loaded = r.data
          setValues(loaded)
          setLoadError(null)
          // Start from the value Piste has now (easier to fix a typo than to retype it).
          setD((x) => {
            const f = correctionField(x.field)
            const cur = loaded.current[x.field]
            return x.resortId === loaded.resortId && x.raw === '' && f && cur !== null && cur !== undefined ? { ...x, raw: toInputValue(f.kind, cur, x.unit) } : x
          })
        } else setLoadError(r.error)
      } catch {
        if (!cancelled) setLoadError('Current values could not be loaded — you can still enter a correction.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [d.resortId])

  const set = (patch: Partial<Draft>, clear: string[] = []) => {
    setD((x) => ({ ...x, ...patch }))
    if (clear.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))))
  }

  function prefill(field: string) {
    const f = correctionField(field)
    const cur = values && values.resortId === d.resortId ? values.current[field] : undefined
    set({ field, raw: f && cur !== undefined ? toInputValue(f.kind, cur, d.unit) : '', unknown: false }, ['field', 'raw'])
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input = {
      resortId: d.resortId,
      field: d.field,
      raw: d.unknown ? null : d.raw,
      unit: d.unit,
      sourceUrl: d.sourceUrl.trim() || null,
      note: d.note.trim() || null,
    }
    run(() => addCorrection(input), {
      onDone: () => close(),
      onError: (r) => setErrors(r.fieldErrors ?? {}),
      undo: (row) => run(() => deleteCorrectionRow({ id: row.id }), { success: 'Correction removed — the previous value is back' }),
    })
  }

  const resortName = resorts.find((r) => r.id === d.resortId)?.name ?? d.resortId
  const corrected = values?.resortId === d.resortId && values.corrected.includes(d.field)
  const seasonMissing = spec.group === 'season' && values?.resortId === d.resortId && !values.hasSeason

  return (
    <form id="correction-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="corr-resort" className="text-[13.5px] font-medium text-ink">
          Resort
        </label>
        <Select id="corr-resort" value={d.resortId} onChange={(e) => set({ resortId: e.target.value, raw: '', unknown: false }, ['resortId', 'raw'])} aria-invalid={!!errors.resortId}>
          {resorts.some((r) => r.favorite) ? (
            <optgroup label="Favourites">
              {resorts
                .filter((r) => r.favorite)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
          <optgroup label="All resorts">
            {resorts
              .filter((r) => !r.favorite)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </optgroup>
        </Select>
        <FieldError id="corr-resort-err" error={errors.resortId} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="corr-field" className="text-[13.5px] font-medium text-ink">
          Field
        </label>
        <Select id="corr-field" value={d.field} onChange={(e) => prefill(e.target.value)} aria-invalid={!!errors.field}>
          {CORRECTION_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {CORRECTION_FIELDS.filter((f) => f.group === g.id).map((f) => (
                <option key={f.field} value={f.field}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {spec.hint ? <p className="text-[12.5px] text-ink-3">{spec.hint}</p> : null}
        <FieldError id="corr-field-err" error={errors.field} />
      </div>

      <div className="rounded-[14px] border border-divider bg-surface-2 px-3.5 py-3 text-[13.5px]" aria-live="polite">
        <p className="text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Piste has now</p>
        <p className="mt-1 flex items-center gap-2 text-ink">
          {loading && current === undefined ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-3" /> Loading…
            </>
          ) : current === undefined ? (
            <span className="text-ink-3 italic">{loadError ?? 'Not loaded'}</span>
          ) : current === null ? (
            <span className="text-ink-3 italic">Unknown / not set</span>
          ) : (
            <span className="break-words">{formatCorrectionValue(spec.kind, current, units)}</span>
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-3">
          {resortName}
          {corrected ? ' · already carries your correction — a new one replaces it (history kept)' : ''}
        </p>
        {seasonMissing ? <p className="mt-1 text-[12.5px] font-medium text-caution">No record for the active season — season fields cannot be corrected for this resort.</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="corr-value" className="text-[13.5px] font-medium text-ink">
          Correct value
        </label>
        <ValueInput spec={spec} d={d} set={set} error={errors.raw} />
        {nullable(spec.kind) && spec.kind !== 'bool?' ? (
          <Checkbox label="Set to unknown" hint="Use when the published value was withdrawn or is wrong and nothing replaces it." checked={d.unknown} onChange={(e) => set({ unknown: e.target.checked }, ['raw'])} className="mt-1" />
        ) : null}
        <FieldError id="corr-value-err" error={errors.raw} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="corr-url" className="text-[13.5px] font-medium text-ink">
          Source link
        </label>
        <TextInput
          id="corr-url"
          type="url"
          inputMode="url"
          placeholder="https://… the page you checked"
          value={d.sourceUrl}
          onChange={(e) => set({ sourceUrl: e.target.value }, ['sourceUrl'])}
          aria-invalid={!!errors.sourceUrl}
          aria-describedby={errors.sourceUrl ? 'corr-url-err' : 'corr-url-hint'}
        />
        {errors.sourceUrl ? <FieldError id="corr-url-err" error={errors.sourceUrl} /> : <p id="corr-url-hint" className="text-[12.5px] text-ink-3">A link, a note, or both — every correction says where it comes from.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="corr-note" className="text-[13.5px] font-medium text-ink">
          Note <span className="font-normal text-ink-3">(optional with a link)</span>
        </label>
        <Textarea id="corr-note" value={d.note} maxLength={500} onChange={(e) => set({ note: e.target.value }, ['note', 'sourceUrl'])} placeholder="e.g. Phoned the ticket office on 3 Oct" className="min-h-20" />
        <FieldError id="corr-note-err" error={errors.note} />
      </div>
      {pending ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Saving…
        </p>
      ) : null}
    </form>
  )
}

function ValueInput({ spec, d, set, error }: { spec: NonNullable<ReturnType<typeof correctionField>>; d: Draft; set: (p: Partial<Draft>, clear?: string[]) => void; error?: string }) {
  const common = {
    id: 'corr-value',
    'aria-invalid': !!error,
    'aria-describedby': error ? 'corr-value-err' : undefined,
    disabled: d.unknown,
  }
  switch (spec.kind) {
    case 'bool?':
      return (
        <Select {...common} value={d.raw || 'unknown'} onChange={(e) => set({ raw: e.target.value }, ['raw'])} className="max-w-[16rem]">
          <option value="yes">Yes — offered</option>
          <option value="no">No — not offered</option>
          <option value="unknown">Unknown</option>
        </Select>
      )
    case 'longtext?':
      return <Textarea {...common} value={d.raw} maxLength={2000} onChange={(e) => set({ raw: e.target.value }, ['raw'])} />
    case 'date?':
      return <TextInput {...common} type="date" value={d.raw} onChange={(e) => set({ raw: e.target.value }, ['raw'])} className="max-w-[12rem] tnum" />
    case 'url?':
      return <TextInput {...common} type="url" inputMode="url" placeholder="https://" value={d.raw} onChange={(e) => set({ raw: e.target.value }, ['raw'])} />
    case 'elevation?':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <TextInput {...common} inputMode="decimal" value={d.raw} onChange={(e) => set({ raw: e.target.value }, ['raw'])} className="max-w-32 tnum" />
          <Segmented
            label="Elevation unit"
            size="sm"
            options={[
              { value: 'ft', label: 'ft' },
              { value: 'm', label: 'm' },
            ]}
            value={d.unit}
            onChange={(unit) => {
              // Keep the same height when switching units (the typed number is converted, not reinterpreted).
              const n = Number(d.raw.trim().replace(/,/g, ''))
              const raw = d.raw.trim() && Number.isFinite(n) && unit !== d.unit ? String(Math.round(unit === 'm' ? n * 0.3048 : n / 0.3048)) : d.raw
              set({ unit, raw }, ['raw'])
            }}
          />
          <span className="text-[12.5px] text-ink-3">Stored in metres</span>
        </div>
      )
    case 'int?':
    case 'number?':
    case 'pct?':
    case 'lat':
    case 'lon':
      return (
        <div className="flex items-center gap-2">
          <TextInput {...common} inputMode="decimal" value={d.raw} onChange={(e) => set({ raw: e.target.value }, ['raw'])} className="max-w-36 tnum" />
          {spec.kind === 'pct?' ? <span className="text-[14px] text-ink-2">%</span> : spec.kind === 'lat' || spec.kind === 'lon' ? <span className="text-[14px] text-ink-2">°</span> : null}
        </div>
      )
    case 'tz':
      return <TextInput {...common} placeholder="e.g. America/Denver" value={d.raw} onChange={(e) => set({ raw: e.target.value }, ['raw'])} className="max-w-sm" />
    default:
      return <TextInput {...common} value={d.raw} maxLength={200} onChange={(e) => set({ raw: e.target.value }, ['raw'])} />
  }
}
