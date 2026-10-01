'use client'
/**
 * Manual-edit routes for conditions data Piste cannot read automatically.
 *
 * - ReportEntrySheet: figures from an official report (snow windows with their wording, depths, surface, grooming,
 *   snowmaking, open terrain, status). A source link is required. Saved through the zod-validated server action,
 *   which calls the jobs module's addManualReport — revisions, status history and season dates follow the same
 *   rules as adapter ingestion, and a reported time more than 5 minutes in the future is refused.
 * - ObservationSheet: MY OWN observation (surface tags + notes). Stored as personal feedback, separately — it never
 *   sets operating status or counts as an official report.
 */
import { useId, useState, useTransition, type ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, Select, TextInput, Textarea } from '@/components/ui/form'
import { Segmented } from '@/components/ui/segmented'
import { Notice } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { submitManualReport, submitPersonalReport, type ManualReportForm } from '@/lib/actions/resort'
import { OPERATING_STATUS_LABEL, OPERATING_STATUSES, SURFACE_LABEL, SURFACE_TAGS, type OperatingStatus, type SnowWindow, type SurfaceTag } from '@/lib/domain/types'
import { dayLabelYear, WINDOW_LABEL } from './format'

const WINDOWS: SnowWindow[] = ['overnight', '24h', '48h', '72h', '7d', 'storm', 'season']
const CHOOSABLE_TAGS = SURFACE_TAGS.filter((t) => t !== 'unknown')

type NumField =
  | 'baseDepth'
  | 'summitDepth'
  | 'groomedRuns'
  | 'openTrails'
  | 'totalTrails'
  | 'openLifts'
  | 'totalLifts'
  | 'openBeginnerTrails'
  | 'totalBeginnerTrails'
  | 'openAcres'

const INT_FIELDS: NumField[] = ['groomedRuns', 'openTrails', 'totalTrails', 'openLifts', 'totalLifts', 'openBeginnerTrails', 'totalBeginnerTrails']

function parseNum(raw: string): number | null | 'invalid' {
  const t = raw.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}

function TagPicker({ value, onChange, legend, hint, error }: { value: SurfaceTag[]; onChange: (v: SurfaceTag[]) => void; legend: string; hint?: string; error?: string }) {
  return (
    <fieldset>
      <legend className="text-[13.5px] font-medium text-ink">{legend}</legend>
      {hint ? <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {CHOOSABLE_TAGS.map((t) => {
          const on = value.includes(t)
          return (
            <label
              key={t}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13.5px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus md:min-h-9',
                on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal',
              )}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])} />
              {on ? <Check aria-hidden className="size-3.5" strokeWidth={2.4} /> : null}
              {SURFACE_LABEL[t]}
            </label>
          )
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] font-medium text-critical">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-divider pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-[15px] font-semibold text-ink">{title}</legend>
      {hint ? <p className="-mt-2 text-[12.5px] text-ink-3">{hint}</p> : null}
      {children}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Official figures

export function ReportEntrySheet({
  resortId,
  resortName,
  today,
  tz,
  defaultUnit,
  officialUrl,
  sourceNote,
  demo,
  triggerContent,
  triggerClassName,
}: {
  resortId: string
  resortName: string
  /** Resort-local today. */
  today: string
  tz: string
  defaultUnit: 'in' | 'cm'
  /** The official snow-report page, prefilled as the source (the user confirms it). */
  officialUrl: string | null
  sourceNote: string | null
  demo: boolean
  /** Content of the trigger button (the button itself is created here so server callers can pass content). */
  triggerContent: ReactNode
  triggerClassName?: string
}) {
  const toast = useToast()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [kind, setKind] = useState<'manual' | 'official'>('manual')
  const [localDate, setLocalDate] = useState(today)
  const [reportedTime, setReportedTime] = useState('')
  const [sourceUrl, setSourceUrl] = useState(officialUrl ?? '')
  const [sourceLabel, setSourceLabel] = useState('')
  const [status, setStatus] = useState<OperatingStatus | ''>('')
  const [unit, setUnit] = useState<'in' | 'cm'>(defaultUnit)
  const [snow, setSnow] = useState<Record<string, { amount: string; text: string }>>({})
  const [nums, setNums] = useState<Record<NumField, string>>({
    baseDepth: '',
    summitDepth: '',
    groomedRuns: '',
    openTrails: '',
    totalTrails: '',
    openLifts: '',
    totalLifts: '',
    openBeginnerTrails: '',
    totalBeginnerTrails: '',
    openAcres: '',
  })
  const [baseDepthLocation, setBaseDepthLocation] = useState('')
  const [tags, setTags] = useState<SurfaceTag[]>([])
  const [surfaceText, setSurfaceText] = useState('')
  const [groomingText, setGroomingText] = useState('')
  const [snowmakingText, setSnowmakingText] = useState('')
  const [notes, setNotes] = useState('')

  const ids = {
    url: useId(),
    label: useId(),
    date: useId(),
    time: useId(),
    status: useId(),
    loc: useId(),
    surfaceText: useId(),
    grooming: useId(),
    snowmaking: useId(),
    notes: useId(),
  }
  const setNum = (k: NumField) => (e: React.ChangeEvent<HTMLInputElement>) => setNums((n) => ({ ...n, [k]: e.target.value }))
  const numInput = (k: NumField, label: string, opts: { hint?: string; suffix?: string } = {}) => (
    <Field label={label} htmlFor={`${formId}-${k}`} error={errors[k]} hint={opts.hint}>
      <div className="relative">
        <TextInput
          id={`${formId}-${k}`}
          inputMode={INT_FIELDS.includes(k) ? 'numeric' : 'decimal'}
          value={nums[k]}
          onChange={setNum(k)}
          aria-invalid={!!errors[k]}
          className={cn('tnum', opts.suffix && 'pr-10')}
        />
        {opts.suffix ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">{opts.suffix}</span> : null}
      </div>
    </Field>
  )

  const submit = () => {
    const fieldErrors: Record<string, string> = {}
    const parsed = {} as Record<NumField, number | null>
    for (const k of Object.keys(nums) as NumField[]) {
      const v = parseNum(nums[k])
      if (v === 'invalid') fieldErrors[k] = 'Enter a number'
      else if (v !== null && INT_FIELDS.includes(k) && !Number.isInteger(v)) fieldErrors[k] = 'Whole numbers only'
      else parsed[k] = v
    }
    const order: SnowWindow[] = []
    const snowfall: ManualReportForm['snowfall'] = []
    for (const w of WINDOWS) {
      const row = snow[w]
      if (!row || (!row.amount.trim() && !row.text.trim())) continue
      const a = parseNum(row.amount)
      if (a === 'invalid') {
        fieldErrors[`snow.${w}`] = 'Enter a number'
        continue
      }
      order.push(w)
      snowfall.push({ window: w, amount: a, sourceText: row.text.trim() || null })
    }
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors)
      setError('Please check the highlighted fields')
      return
    }
    start(async () => {
      setError(null)
      setErrors({})
      const r = await submitManualReport({
        resortId,
        localDate,
        kind,
        sourceUrl: sourceUrl.trim(),
        sourceLabel: sourceLabel.trim() || null,
        reportedTime: reportedTime || null,
        status: status || null,
        snowUnit: unit,
        snowfall,
        baseDepth: parsed.baseDepth,
        baseDepthLocation: baseDepthLocation.trim() || null,
        summitDepth: parsed.summitDepth,
        surfaceTags: tags,
        surfaceText: surfaceText.trim() || null,
        groomingText: groomingText.trim() || null,
        groomedRuns: parsed.groomedRuns,
        snowmakingText: snowmakingText.trim() || null,
        openTrails: parsed.openTrails,
        totalTrails: parsed.totalTrails,
        openLifts: parsed.openLifts,
        totalLifts: parsed.totalLifts,
        openBeginnerTrails: parsed.openBeginnerTrails,
        totalBeginnerTrails: parsed.totalBeginnerTrails,
        openAcres: parsed.openAcres,
        notes: notes.trim() || null,
      })
      if (!r.ok) {
        const mapped: Record<string, string> = {}
        for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) {
          const m = /^snowfall\.(\d+)\./.exec(k)
          if (m && order[Number(m[1])]) mapped[`snow.${order[Number(m[1])]}`] = msg
          else mapped[k] = msg
        }
        setErrors(mapped)
        setError(r.error)
        return
      }
      toast.show(r.message ?? 'Report saved')
      setOpen(false)
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={triggerClassName}>
          {triggerContent}
        </button>
      }
      widthClass="md:w-[600px]"
      title={`Enter a report for ${resortName}`}
      description="Type what the official report says. It is stored as a manual record with your source link — the manual-edit route for data Piste cannot read automatically."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-3">{demo ? 'Demo mode — saved to the demo database only.' : 'Saved as a new revision; earlier reports are kept.'}</p>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save report'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        <Group title="Source" hint="Required for official figures. Open the page, then copy what it says.">
          <Field label="Source link" htmlFor={ids.url} error={errors.sourceUrl} hint={sourceNote ?? undefined}>
            <TextInput
              id={ids.url}
              type="url"
              inputMode="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              required
              aria-invalid={!!errors.sourceUrl}
            />
          </Field>
          {officialUrl ? (
            <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="-mt-1 inline-flex items-center gap-1 self-start text-[13px] font-medium text-teal hover:underline">
              Open the official snow report <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
          <Field label="Source name" htmlFor={ids.label} optional error={errors.sourceLabel}>
            <TextInput id={ids.label} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} maxLength={120} placeholder="e.g. Conditions page" />
          </Field>
          <Segmented
            label="What are you entering?"
            hideLabel={false}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'manual', label: 'Typed from the page', hint: 'Transcribed by you from the official page' },
              { value: 'official', label: 'Official report I verified', hint: 'The official report itself, verified by you' },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Report date" htmlFor={ids.date} error={errors.localDate} hint="Resort-local date">
              <TextInput id={ids.date} type="date" value={localDate} max={today} onChange={(e) => setLocalDate(e.target.value)} className="tnum" aria-invalid={!!errors.localDate} />
            </Field>
            <Field label="Published at" htmlFor={ids.time} optional error={errors.reportedTime ?? errors.reportedAt} hint={`Resort time (${tz.split('/').pop()?.replace(/_/g, ' ')})`}>
              <TextInput id={ids.time} type="time" value={reportedTime} onChange={(e) => setReportedTime(e.target.value)} className="tnum" aria-invalid={!!(errors.reportedTime ?? errors.reportedAt)} />
            </Field>
          </div>
        </Group>

        <Group title="Operating status" hint="Only if the report states it — it is never guessed. Without it, the day’s status counts as unknown for scoring (never as open).">
          <Field label="Status on that date" htmlFor={ids.status} error={errors.status}>
            <Select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as OperatingStatus | '')}>
              <option value="">Not stated</option>
              {OPERATING_STATUSES.filter((s) => s !== 'unknown').map((s) => (
                <option key={s} value={s}>
                  {OPERATING_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </Group>

        <Group title="Reported snowfall" hint="Each window as the report states it, with its wording. Windows are never added together.">
          <Segmented
            label="Snow unit"
            size="sm"
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'in', label: 'Inches' },
              { value: 'cm', label: 'Centimetres' },
            ]}
          />
          <div className="grid grid-cols-[minmax(0,92px)_minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-x-2 gap-y-2">
            <span className="text-[12.5px] font-medium text-ink-3">Window</span>
            <span className="text-[12.5px] font-medium text-ink-3">Amount ({unit})</span>
            <span className="text-[12.5px] font-medium text-ink-3">Wording on the page</span>
            {WINDOWS.map((w) => {
              const row = snow[w] ?? { amount: '', text: '' }
              const err = errors[`snow.${w}`]
              return (
                <div key={w} className="contents">
                  <label htmlFor={`${formId}-snow-${w}`} className="text-[13.5px] text-ink">
                    {WINDOW_LABEL[w]}
                  </label>
                  <TextInput
                    id={`${formId}-snow-${w}`}
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) => setSnow((s) => ({ ...s, [w]: { ...row, amount: e.target.value } }))}
                    aria-invalid={!!err}
                    aria-describedby={err ? `${formId}-snow-${w}-err` : undefined}
                    className="tnum"
                  />
                  <TextInput
                    aria-label={`${WINDOW_LABEL[w]} wording`}
                    value={row.text}
                    maxLength={200}
                    onChange={(e) => setSnow((s) => ({ ...s, [w]: { ...row, text: e.target.value } }))}
                    placeholder={w === '24h' ? 'e.g. 4" in 24 hrs' : ''}
                  />
                  {err ? (
                    <p id={`${formId}-snow-${w}-err`} role="alert" className="col-span-3 -mt-1 text-[12.5px] font-medium text-critical">
                      {WINDOW_LABEL[w]}: {err}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Group>

        <Group title="Snow depth">
          <div className="grid grid-cols-2 gap-3">
            {numInput('baseDepth', 'Base depth', { suffix: unit })}
            {numInput('summitDepth', 'Summit depth', { suffix: unit })}
          </div>
          <Field label="Where the base depth is measured" htmlFor={ids.loc} optional error={errors.baseDepthLocation}>
            <TextInput id={ids.loc} value={baseDepthLocation} onChange={(e) => setBaseDepthLocation(e.target.value)} maxLength={120} placeholder="e.g. Mid-mountain stake" />
          </Field>
        </Group>

        <Group title="Surface, grooming and snowmaking" hint="Kept separate: firm or wet describes the surface, grooming is a management action, machine-made snow is an origin.">
          <TagPicker legend="Surface as reported" value={tags} onChange={setTags} error={errors.surfaceTags} />
          <Field label="Surface wording" htmlFor={ids.surfaceText} optional error={errors.surfaceText}>
            <TextInput id={ids.surfaceText} value={surfaceText} onChange={(e) => setSurfaceText(e.target.value)} maxLength={1000} placeholder="e.g. Packed powder, loose granular" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <Field label="Grooming" htmlFor={ids.grooming} optional error={errors.groomingText}>
              <TextInput id={ids.grooming} value={groomingText} onChange={(e) => setGroomingText(e.target.value)} maxLength={1000} placeholder="e.g. 28 trails groomed overnight" />
            </Field>
            {numInput('groomedRuns', 'Groomed runs')}
          </div>
          <Field label="Snowmaking" htmlFor={ids.snowmaking} optional error={errors.snowmakingText}>
            <TextInput id={ids.snowmaking} value={snowmakingText} onChange={(e) => setSnowmakingText(e.target.value)} maxLength={1000} placeholder="e.g. Making snow on 7 trails" />
          </Field>
        </Group>

        <Group title="Open terrain" hint="Beginner trails matter most for a learning day.">
          <div className="grid grid-cols-2 gap-3">
            {numInput('openTrails', 'Trails open')}
            {numInput('totalTrails', 'Trails total')}
            {numInput('openLifts', 'Lifts open')}
            {numInput('totalLifts', 'Lifts total')}
            {numInput('openBeginnerTrails', 'Beginner trails open')}
            {numInput('totalBeginnerTrails', 'Beginner trails total')}
            {numInput('openAcres', 'Acres open')}
          </div>
        </Group>

        <Group title="Notes">
          <Field label="Anything else the report says" htmlFor={ids.notes} optional error={errors.notes}>
            <Textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
          </Field>
        </Group>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// My own observation

export function ObservationSheet({
  resortId,
  resortName,
  today,
  demo,
  triggerContent,
  triggerClassName,
}: {
  resortId: string
  resortName: string
  today: string
  demo: boolean
  triggerContent: ReactNode
  triggerClassName?: string
}) {
  const toast = useToast()
  const formId = useId()
  const ids = { date: useId(), text: useId(), notes: useId() }
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [localDate, setLocalDate] = useState(today)
  const [tags, setTags] = useState<SurfaceTag[]>([])
  const [surfaceText, setSurfaceText] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={triggerClassName}>
          {triggerContent}
        </button>
      }
      title={`My observation at ${resortName}`}
      description="What you found on the snow. Kept as personal feedback, separate from official reports — it never sets the operating status."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-3">{demo ? 'Demo mode — saved to the demo database only.' : 'Private to you.'}</p>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save observation'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            setError(null)
            setErrors({})
            const r = await submitPersonalReport({ resortId, localDate, surfaceTags: tags, surfaceText: surfaceText.trim() || null, notes: notes.trim() || null })
            if (!r.ok) {
              setError(r.error)
              setErrors(r.fieldErrors ?? {})
              return
            }
            toast.show(r.message ?? 'Observation saved')
            setOpen(false)
            setTags([])
            setSurfaceText('')
            setNotes('')
          })
        }}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        <Field label="Day" htmlFor={ids.date} error={errors.localDate} hint={`Today is ${dayLabelYear(today)} at the resort`}>
          <TextInput id={ids.date} type="date" value={localDate} max={today} onChange={(e) => setLocalDate(e.target.value)} className="tnum" aria-invalid={!!errors.localDate} />
        </Field>
        <TagPicker legend="Surface I found" hint="Pick any that fit." value={tags} onChange={setTags} error={errors.surfaceTags} />
        <Field label="In my words" htmlFor={ids.text} optional error={errors.surfaceText}>
          <TextInput id={ids.text} value={surfaceText} onChange={(e) => setSurfaceText(e.target.value)} maxLength={1000} placeholder="e.g. Icy patches on the steeper greens by 2pm" />
        </Field>
        <Field label="Notes" htmlFor={ids.notes} optional error={errors.notes} hint="Crowds are your guess — Piste never shows live queues.">
          <Textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
        </Field>
      </form>
    </Sheet>
  )
}
