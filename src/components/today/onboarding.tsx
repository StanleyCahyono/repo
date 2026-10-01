'use client'
/**
 * First-run setup: one short, skippable panel with five compact fields — home, ability, units, the exact passes you
 * own (or none) and travel limits. Saving or skipping sets `onboardingDone`; Settings edits everything later (budget,
 * gear, companions, lodging…). Pass ownership starts unset: a pass is only recorded when you tick an exact product,
 * and a resort's affiliation never implies you own anything.
 */
import { useId, useState, useTransition, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { LoaderCircle, MapPin, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { useToast } from '@/components/ui/toast'
import { completeOnboarding, skipOnboarding } from '@/lib/actions/today'
import { ABILITY_LEVELS, type AbilityLevel, type UnitPrefs } from '@/lib/domain/types'
import type { OnboardingOptions } from './data'

const ABILITY_LABEL: Record<AbilityLevel, string> = {
  beginner: 'Beginner — first days, lessons',
  novice: 'Novice — linking turns on greens',
  intermediate: 'Intermediate — most blues',
  advanced: 'Advanced — blacks, variable snow',
  expert: 'Expert — anything open',
}

const ZONES = [
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Zurich',
  'Europe/Vienna',
]

const DRIVE_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'Up to 1 h' },
  { value: '2', label: 'Up to 2 h' },
  { value: '3', label: 'Up to 3 h' },
  { value: '4', label: 'Up to 4 h' },
  { value: '5', label: 'Up to 5 h' },
  { value: '6', label: 'Up to 6 h' },
  { value: '8', label: 'Up to 8 h' },
  { value: 'none', label: 'No limit' },
]

type UnitSystem = 'us' | 'metric' | 'current'
const US: Omit<UnitPrefs, 'speed'> = {
  temperature: 'F',
  snow: 'in',
  distance: 'mi',
  elevation: 'ft',
}
const METRIC: Omit<UnitPrefs, 'speed'> = {
  temperature: 'C',
  snow: 'cm',
  distance: 'km',
  elevation: 'm',
}
const systemOf = (u: UnitPrefs): UnitSystem =>
  (Object.keys(US) as (keyof typeof US)[]).every((k) => u[k] === US[k])
    ? 'us'
    : (Object.keys(METRIC) as (keyof typeof METRIC)[]).every((k) => u[k] === METRIC[k])
      ? 'metric'
      : 'current'

const fieldLabel = 'text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase'
const control = 'h-11 w-full rounded-md border border-divider-strong bg-surface px-3 text-[14.5px] text-ink md:h-10'

export function OnboardingPanel({ options }: { options: OnboardingOptions }) {
  const toast = useToast()
  const uid = useId()
  const [pending, start] = useTransition()
  const [skipping, startSkip] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [editHome, setEditHome] = useState(false)
  const [home, setHome] = useState({
    name: options.home.name,
    lat: String(options.home.lat),
    lon: String(options.home.lon),
    timezone: options.home.timezone,
  })
  const [ability, setAbility] = useState<AbilityLevel>(options.ability)
  const [units, setUnits] = useState<UnitSystem>(systemOf(options.units))
  const owned = options.products.filter((p) => p.owned).map((p) => p.id)
  const [hasPass, setHasPass] = useState(owned.length > 0)
  const [passes, setPasses] = useState<string[]>(owned)
  const [drive, setDrive] = useState(options.travel.maxDriveHours === null ? 'none' : String(options.travel.maxDriveHours))
  const [fly, setFly] = useState(options.travel.willingToFly)

  const families = [...new Set(options.products.map((p) => p.familyName))]
  const zones = ZONES.includes(options.home.timezone) ? ZONES : [options.home.timezone, ...ZONES]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const lat = Number(home.lat)
    const lon = Number(home.lon)
    start(async () => {
      const res = await completeOnboarding({
        home: editHome
          ? {
              name: home.name,
              lat: Number.isFinite(lat) ? lat : NaN,
              lon: Number.isFinite(lon) ? lon : NaN,
              timezone: home.timezone,
            }
          : null,
        ability,
        units:
          units === 'current'
            ? {
                temperature: options.units.temperature,
                snow: options.units.snow,
                distance: options.units.distance,
                elevation: options.units.elevation,
              }
            : units === 'us'
              ? US
              : METRIC,
        passes: hasPass ? passes.filter((id) => !owned.includes(id)) : [],
        travel: {
          maxDriveHours: drive === 'none' ? null : Number(drive),
          willingToFly: fly,
        },
      })
      if (!res.ok) {
        setError(res.error)
        setFieldErrors(res.fieldErrors ?? {})
        return
      }
      toast.show(res.message ?? 'Preferences saved')
    })
  }

  const skip = () =>
    startSkip(async () => {
      const res = await skipOnboarding()
      if (res.ok) toast.show(res.message ?? 'Setup skipped', { tone: 'info' })
      else setError(res.error)
    })

  const busy = pending || skipping
  const err = (k: string) => fieldErrors[k] ?? Object.entries(fieldErrors).find(([key]) => key.startsWith(`${k}.`))?.[1] ?? null

  return (
    <motion.section
      aria-labelledby={`${uid}-title`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t.pageIn}
      className="mb-6 rounded-[14px] border border-teal/40 bg-surface"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4 md:px-6">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Setup · one screen, all optional</p>
          <h2 id={`${uid}-title`} className="text-[19px] leading-snug font-semibold text-ink">
            Tune Today to you
          </h2>
          <p className="mt-1 max-w-[70ch] text-[14px] text-ink-2">
            Five quick answers shape every recommendation. Budget, gear, companions and lodging can wait — Settings has them all.
          </p>
        </div>
        <button
          type="button"
          onClick={skip}
          disabled={busy}
          aria-label="Skip setup"
          title="Skip setup"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink md:size-9"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <form onSubmit={submit} className="px-4 pt-4 pb-4 md:px-6" noValidate>
        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr]">
          {/* 1 · Home */}
          <fieldset className="min-w-0">
            <legend className={fieldLabel}>Home</legend>
            {editHome ? (
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-ink-2">
                  Name
                  <input
                    className={control}
                    value={home.name}
                    onChange={(e) => setHome({ ...home, name: e.target.value })}
                    autoComplete="address-level2"
                    aria-invalid={!!err('home.name') || undefined}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
                  Latitude
                  <input
                    className={cn(control, 'tnum')}
                    inputMode="decimal"
                    value={home.lat}
                    onChange={(e) => setHome({ ...home, lat: e.target.value })}
                    aria-invalid={!!err('home.lat') || undefined}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
                  Longitude
                  <input
                    className={cn(control, 'tnum')}
                    inputMode="decimal"
                    value={home.lon}
                    onChange={(e) => setHome({ ...home, lon: e.target.value })}
                    aria-invalid={!!err('home.lon') || undefined}
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-ink-2">
                  Time zone
                  <select className={control} value={home.timezone} onChange={(e) => setHome({ ...home, timezone: e.target.value })}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                {err('home') ? <p className="col-span-2 text-[12.5px] font-medium text-critical">{err('home')}</p> : null}
                <p className="col-span-2 text-[12px] leading-snug text-ink-3">Curated drive times start from Ithaca, NY — check them after a move.</p>
              </div>
            ) : (
              <div className="mt-1.5 flex min-h-11 items-center justify-between gap-2 rounded-md border border-divider bg-surface-2 px-3 md:min-h-10">
                <span className="flex min-w-0 items-center gap-2 text-[14.5px] text-ink">
                  <MapPin aria-hidden className="size-4 shrink-0 text-ink-3" />
                  <span className="truncate">{options.home.name}</span>
                  <span className="truncate text-[12.5px] text-ink-3 max-xl:hidden">{options.home.timezone.replace(/_/g, ' ')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditHome(true)}
                  className="h-9 shrink-0 rounded-md px-2 text-[13.5px] font-medium text-teal hover:bg-glacier/60"
                >
                  Change<span className="sr-only"> home</span>
                </button>
              </div>
            )}
          </fieldset>

          {/* 2 · Ability */}
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={fieldLabel}>Ability</span>
            <select className={control} value={ability} onChange={(e) => setAbility(e.target.value as AbilityLevel)}>
              {ABILITY_LEVELS.map((a) => (
                <option key={a} value={a}>
                  {ABILITY_LABEL[a]}
                </option>
              ))}
            </select>
          </label>

          {/* 3 · Units */}
          <fieldset className="min-w-0">
            <legend className={fieldLabel}>Units</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  ['us', 'US', '°F · in · mi · ft'],
                  ['metric', 'Metric', '°C · cm · km · m'],
                  ...(systemOf(options.units) === 'current' ? [['current', 'Keep my mix', 'as set now'] as const] : []),
                ] as const
              ).map(([v, label, hint]) => (
                <label
                  key={v}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-[14px] transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-teal md:min-h-10',
                    units === v ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal',
                  )}
                >
                  <input type="radio" name={`${uid}-units`} value={v} checked={units === v} onChange={() => setUnits(v)} className="sr-only" />
                  <span className="font-medium">{label}</span>
                  <span className="tnum text-[12.5px] opacity-80 md:max-xl:hidden">{hint}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-ink-3">Mix them one by one in Settings.</p>
          </fieldset>

          {/* 4 · Passes */}
          <fieldset className="@container min-w-0 xl:col-span-2">
            <legend className={fieldLabel}>Passes you own for {options.seasonLabel}</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  [false, 'No pass'],
                  [true, 'I own a pass'],
                ] as const
              ).map(([v, label]) => (
                <label
                  key={String(v)}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-[14px] font-medium transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-teal md:min-h-10',
                    hasPass === v ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink-2 hover:border-teal',
                  )}
                >
                  <input type="radio" name={`${uid}-haspass`} checked={hasPass === v} onChange={() => setHasPass(v)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            {hasPass ? (
              <div
                className="mt-2 max-h-56 overflow-y-auto rounded-md border border-divider bg-surface-2 px-3 py-2 scrollbar-thin"
                role="group"
                aria-label="Exact pass products"
              >
                {families.map((f) => (
                  <div key={f} className="py-1">
                    <p className="text-[12px] font-semibold text-ink-3">{f}</p>
                    <ul className="mt-0.5 grid gap-x-4 @min-[460px]:grid-cols-2">
                      {options.products
                        .filter((p) => p.familyName === f)
                        .map((p) => {
                          const isOwned = owned.includes(p.id)
                          return (
                            <li key={p.id}>
                              <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13.5px] text-ink">
                                <input
                                  type="checkbox"
                                  className="size-4 accent-teal"
                                  checked={passes.includes(p.id)}
                                  disabled={isOwned}
                                  onChange={(e) => setPasses((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                                />
                                <span className="min-w-0">
                                  {p.name}
                                  {isOwned ? <span className="text-ink-3"> · recorded</span> : null}
                                </span>
                              </label>
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-[12px] text-ink-3">
              {hasPass
                ? 'Tick the exact product — access is answered per product, never from the family name. What you paid goes in Passes & Costs.'
                : 'Resorts’ pass families are shown for discovery only; none is assumed yours.'}
            </p>
            {err('passes') ? <p className="text-[12.5px] font-medium text-critical">{err('passes')}</p> : null}
          </fieldset>

          {/* 5 · Travel */}
          <fieldset className="min-w-0">
            <legend className={fieldLabel}>Travel</legend>
            <label className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-ink-2">
              Longest drive for a ski day
              <select className={control} value={drive} onChange={(e) => setDrive(e.target.value)}>
                {DRIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-ink md:min-h-9">
              <input type="checkbox" className="size-4 accent-teal" checked={fly} onChange={(e) => setFly(e.target.checked)} />
              Willing to fly for bigger trips
            </label>
          </fieldset>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[13.5px] font-medium text-critical">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-teal bg-teal px-4 text-[14.5px] font-medium text-on-teal transition-colors duration-150 hover:bg-teal-strong disabled:opacity-60 md:h-10"
          >
            {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
            Save and continue
          </button>
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-[14.5px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-60 md:h-10"
          >
            {skipping ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
            Skip — keep the defaults
          </button>
        </div>
      </form>
    </motion.section>
  )
}
