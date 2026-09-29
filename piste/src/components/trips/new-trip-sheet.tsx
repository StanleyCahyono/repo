'use client'
/**
 * New trip, in two steps: 1) dates and party, 2) resort(s) and which days you ski where. Creates a draft with a ski
 * day per chosen date (and the checklist from your templates), then opens it so you can add travel, lodging, lessons
 * and costs. Opens from the button or from the URL (/trips?new=1&resort=alta&start=2027-02-13&end=2027-02-17) so
 * other screens can link straight into it.
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Car, Check, Minus, Plane, Plus, Search, Star } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, TextInput } from '@/components/ui/form'
import { Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { addDays, daysBetween, formatLocalDate, isLocalDate, nextSaturday } from '@/lib/domain/time'
import type { PickerResort } from '@/lib/data/trip-plan'
import { createTrip } from '@/lib/actions/trips'
import { useRunAction } from './use-run'
import { dayLabel, duration, plural, tripDateLabel, tripDays } from './format'

const MAX_DAYS = 30

function weekendChoices(today: string) {
  const sat = nextSaturday(addDays(today, 1))
  return [0, 7, 14].map((k) => ({ start: addDays(sat, k), end: addDays(sat, k + 1) }))
}

export function NewTripButton({ className, children = 'New trip', variant = 'primary' }: { className?: string; children?: ReactNode; variant?: 'primary' | 'secondary' }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return (
    <Button
      variant={variant}
      className={cn('h-11 md:h-10', className)}
      onClick={() => {
        const next = new URLSearchParams(params.toString())
        next.set('new', '1')
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
      }}
    >
      <Plus aria-hidden className="size-4" /> {children}
    </Button>
  )
}

export function NewTripSheet({ resorts, today, templateCount }: { resorts: PickerResort[]; today: string; templateCount: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const open = params.get('new') === '1'
  const close = () => {
    const next = new URLSearchParams(params.toString())
    for (const k of ['new', 'resort', 'start', 'end', 'party']) next.delete(k)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? null : close())}
      title="New trip"
      description="Start from dates and resorts. Add travel, lodging, lessons and costs next — nothing is booked from here."
      widthClass="md:w-[540px]"
    >
      {open ? <NewTripForm resorts={resorts} today={today} templateCount={templateCount} prefill={params} onDone={(id) => router.push(`/trips/${id}`)} /> : null}
    </Sheet>
  )
}

function NewTripForm({ resorts, today, templateCount, prefill, onDone }: { resorts: PickerResort[]; today: string; templateCount: number; prefill: URLSearchParams; onDone: (id: string) => void }) {
  const uid = useId()
  const weekends = useMemo(() => weekendChoices(today), [today])
  const pStart = prefill.get('start')
  const pEnd = prefill.get('end')
  const pResorts = (prefill.get('resort') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => resorts.some((r) => r.id === x))
  const [step, setStep] = useState<1 | 2>(pResorts.length && pStart ? 2 : 1)
  const [start, setStart] = useState(pStart && isLocalDate(pStart) ? pStart : weekends[0].start)
  const [end, setEnd] = useState(pEnd && isLocalDate(pEnd) ? pEnd : pStart && isLocalDate(pStart) ? pStart : weekends[0].end)
  const [party, setParty] = useState(Math.min(12, Math.max(1, Number(prefill.get('party')) || 1)))
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ id: string; dates: string[] }[]>(() => pResorts.map((id, k) => ({ id, dates: k === 0 && pStart && isLocalDate(pStart) ? tripDays(pStart, pEnd && isLocalDate(pEnd) ? pEnd : pStart) : [] })))
  const [templates, setTemplates] = useState(templateCount > 0)
  const [error, setError] = useState<string | null>(null)
  const { run, pending } = useRunAction()

  const len = start && end && isLocalDate(start) && isLocalDate(end) ? daysBetween(start, end) + 1 : 0
  const datesError = !isLocalDate(start) || !isLocalDate(end) ? 'Choose both dates' : len < 1 ? 'The trip ends before it starts' : len > MAX_DAYS ? `Keep a trip under ${MAX_DAYS} days` : null
  const days = useMemo(() => (datesError ? [] : tripDays(start, end)), [start, end, datesError])
  const past = !datesError && end < today

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? resorts.filter((r) => `${r.name} ${r.shortName} ${r.region} ${r.place ?? ''}`.toLowerCase().includes(q)) : resorts
    return list.slice(0, q ? 40 : 60)
  }, [resorts, query])
  const byId = new Map(resorts.map((r) => [r.id, r]))
  // Chosen ski days always stay inside the current dates (changing the dates never leaves days outside the trip).
  const chosen = picked.map((p) => ({ ...p, dates: p.dates.filter((d) => days.includes(d)) }))
  const assigned = new Set(chosen.flatMap((p) => p.dates))

  const toggleResort = (id: string) =>
    setPicked((p) => {
      if (p.some((x) => x.id === id)) return p.filter((x) => x.id !== id)
      if (p.length >= 6) return p
      const free = days.filter((d) => !p.some((x) => x.dates.includes(d)))
      return [...p, { id, dates: free }]
    })
  const toggleDay = (id: string, d: string) =>
    setPicked((p) => p.map((x) => (x.id === id ? { ...x, dates: x.dates.filter((y) => days.includes(y)).includes(d) ? x.dates.filter((y) => y !== d && days.includes(y)) : [...x.dates.filter((y) => days.includes(y)), d].sort() } : x)))

  const create = (withResorts: boolean) => {
    setError(null)
    run(
      () =>
        createTrip({
          name: name.trim() || null,
          startDate: start,
          endDate: end,
          partySize: party,
          resorts: withResorts ? chosen.filter((p) => p.dates.length).map((p) => ({ resortId: p.id, dates: p.dates })) : [],
          applyTemplates: templates,
        }),
      {
        success: (d) => `${d.name} created — add travel, lodging and costs next`,
        onDone: (d) => onDone(d.tripId),
        onError: (r) => setError(r.error),
      },
    )
  }

  const steps = [
    { n: 1 as const, label: 'Dates & party' },
    { n: 2 as const, label: 'Resorts & ski days' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <ol className="grid grid-cols-2 gap-1 rounded-[10px] border border-divider bg-surface-2 p-0.5" aria-label="Steps">
        {steps.map((s) => (
          <li key={s.n} className="relative">
            <button
              type="button"
              aria-current={step === s.n ? 'step' : undefined}
              disabled={s.n === 2 && !!datesError}
              onClick={() => setStep(s.n)}
              className={cn('relative flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13.5px] font-medium transition-colors duration-150 disabled:opacity-50', step === s.n ? 'text-teal' : 'text-ink-2 hover:text-ink')}
            >
              {step === s.n ? <motion.span layoutId="new-trip-step" transition={t.select} aria-hidden className="absolute inset-0 rounded-[8px] border border-divider bg-surface shadow-[0_1px_2px_rgb(12_30_42/0.08)]" /> : null}
              <span className="relative inline-flex size-5 items-center justify-center rounded-full border border-current text-[11.5px] tnum">{step > s.n ? <Check aria-hidden className="size-3" /> : s.n}</span>
              <span className="relative">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {error ? <Notice tone="error" title={error} /> : null}

      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={t.select} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <legend className="eyebrow mb-2">When</legend>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Upcoming weekends">
                {weekends.map((w) => {
                  const on = w.start === start && w.end === end
                  return (
                    <button
                      key={w.start}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setStart(w.start)
                        setEnd(w.end)
                      }}
                      className={cn('inline-flex h-10 items-center rounded-full border px-3.5 text-[13.5px] font-medium transition-colors duration-150 tnum', on ? 'border-teal bg-glacier text-teal' : 'border-divider-strong bg-surface text-ink hover:border-teal')}
                    >
                      {formatLocalDate(w.start, 'ccc d')}–{formatLocalDate(w.end, 'ccc d LLL')}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First day" htmlFor={`${uid}-s`}>
                  <TextInput
                    id={`${uid}-s`}
                    type="date"
                    value={start}
                    onChange={(e) => {
                      const v = e.target.value
                      setStart(v)
                      if (isLocalDate(v) && (!isLocalDate(end) || end < v)) setEnd(v)
                    }}
                  />
                </Field>
                <Field label="Last day" htmlFor={`${uid}-e`} error={datesError && start && end ? datesError : undefined}>
                  <TextInput id={`${uid}-e`} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!datesError} />
                </Field>
              </div>
              {!datesError ? (
                <p className="text-[13px] text-ink-2 tnum">
                  {tripDateLabel(start, end)} · {plural(len, 'day')}
                  {len > 1 ? `, ${plural(len - 1, 'night')}` : ''}
                  {past ? <span className="font-medium text-caution"> · these dates are in the past</span> : null}
                </p>
              ) : null}
            </fieldset>

            <fieldset className="flex items-center justify-between gap-4">
              <legend className="sr-only">Party size</legend>
              <div>
                <p className="text-[14.5px] font-medium text-ink">Party size</p>
                <p className="text-[12.5px] text-ink-3">Name companions later; per-person costs count once for each person.</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="One fewer person" disabled={party <= 1} onClick={() => setParty((p) => Math.max(1, p - 1))} className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface hover:border-teal hover:text-teal disabled:opacity-40 md:size-10">
                  <Minus aria-hidden className="size-4" />
                </button>
                <output aria-live="polite" className="w-10 text-center font-display text-[28px] leading-none text-ink tnum">
                  {party}
                </output>
                <button type="button" aria-label="One more person" disabled={party >= 12} onClick={() => setParty((p) => Math.min(12, p + 1))} className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface hover:border-teal hover:text-teal disabled:opacity-40 md:size-10">
                  <Plus aria-hidden className="size-4" />
                </button>
              </div>
            </fieldset>

            <Field label="Name" htmlFor={`${uid}-n`} optional hint="Suggested from the resort and dates when left empty.">
              <TextInput id={`${uid}-n`} value={name} maxLength={120} placeholder="e.g. Alta — Presidents’ Day" onChange={(e) => setName(e.target.value)} />
            </Field>

            <div className="flex justify-end">
              <Button variant="primary" className="h-11 md:h-10" disabled={!!datesError} onClick={() => setStep(2)}>
                Choose resorts <ArrowRight aria-hidden className="size-4" />
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={t.select} className="flex flex-col gap-5">
            <p className="text-[13px] text-ink-2 tnum">
              {tripDateLabel(start, end)} · party of {party}
            </p>

            {chosen.length ? (
              <div className="flex flex-col gap-3">
                {chosen.map((p) => {
                  const r = byId.get(p.id)!
                  return (
                    <fieldset key={p.id} className="rounded-[12px] border border-teal/40 bg-glacier/35 p-3">
                      <legend className="sr-only">Ski days at {r.name}</legend>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14.5px] font-semibold text-ink">{r.name}</p>
                          <p className="text-[12.5px] text-ink-2">{p.dates.length ? `${plural(p.dates.length, 'ski day')}` : 'Pick the days you’ll ski here'}</p>
                        </div>
                        <button type="button" onClick={() => toggleResort(p.id)} className="h-9 shrink-0 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:text-critical">
                          Remove<span className="sr-only"> {r.name}</span>
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {days.map((d) => {
                          const on = p.dates.includes(d)
                          const elsewhere = !on && assigned.has(d)
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleDay(p.id, d)}
                              title={elsewhere ? 'Already a ski day at another resort' : undefined}
                              className={cn(
                                'inline-flex h-9 min-w-[64px] flex-col items-center justify-center rounded-[8px] border px-2 text-[12px] leading-tight transition-colors duration-150 tnum',
                                on ? 'border-teal bg-teal text-on-teal' : elsewhere ? 'border-dashed border-divider-strong bg-surface text-ink-3' : 'border-divider-strong bg-surface text-ink hover:border-teal',
                              )}
                            >
                              <span className="font-semibold">{formatLocalDate(d, 'ccc')}</span>
                              <span>{formatLocalDate(d, 'd LLL')}</span>
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                  )
                })}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <label htmlFor={`${uid}-q`} className="text-[13.5px] font-medium text-ink">
                {picked.length ? 'Add another resort' : 'Where are you skiing?'}
              </label>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                <TextInput id={`${uid}-q`} value={query} placeholder="Search resorts, towns, regions" className="pl-9" onChange={(e) => setQuery(e.target.value)} />
              </div>
              <ul className="max-h-[320px] overflow-y-auto rounded-[12px] border border-divider bg-surface scrollbar-thin" aria-label="Resorts">
                {filtered.map((r) => {
                  const on = picked.some((p) => p.id === r.id)
                  return (
                    <li key={r.id} className="border-b border-divider last:border-0">
                      <button type="button" aria-pressed={on} onClick={() => toggleResort(r.id)} className={cn('flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150', on ? 'bg-glacier/50' : 'hover:bg-surface-2')}>
                        <span aria-hidden className={cn('flex size-5 shrink-0 items-center justify-center rounded-[5px] border', on ? 'border-teal bg-teal text-on-teal' : 'border-divider-strong bg-surface')}>
                          {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
                            {r.favorite ? <Star aria-label="Favourite" className="size-3.5 shrink-0 text-copper" fill="currentColor" /> : null}
                            <span className="truncate">{r.name}</span>
                          </span>
                          <span className="block truncate text-[12.5px] text-ink-3">{[r.place, r.region].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="shrink-0 text-right text-[12.5px] text-ink-2 tnum">
                          {r.driveMinutes !== null ? (
                            <span className="inline-flex items-center gap-1">
                              <Car aria-hidden className="size-3.5 text-ink-3" /> {duration(r.driveMinutes)}
                            </span>
                          ) : r.flyVia.length ? (
                            <span className="inline-flex items-center gap-1">
                              <Plane aria-hidden className="size-3.5 text-ink-3" /> {r.flyVia.slice(0, 2).join(', ')}
                            </span>
                          ) : (
                            <span className="text-ink-3 italic">travel unknown</span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
                {!filtered.length ? <li className="px-3 py-4 text-[13.5px] text-ink-3">No resort matches “{query}”.</li> : null}
              </ul>
              <p className="text-[12px] text-ink-3">Drive times are curated one-way estimates from home, not live routing.</p>
            </div>

            <Checkbox
              label={templateCount ? `Start the checklist from my templates (${templateCount})` : 'Start the checklist from my templates'}
              hint={templateCount ? undefined : 'You have no checklist templates yet.'}
              checked={templates}
              disabled={!templateCount}
              onChange={(e) => setTemplates(e.target.checked)}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
              <Button variant="ghost" className="h-11 md:h-10" onClick={() => setStep(1)}>
                <ArrowLeft aria-hidden className="size-4" /> Dates
              </Button>
              <div className="flex flex-wrap gap-2">
                {!picked.length ? (
                  <Button variant="secondary" className="h-11 md:h-10" disabled={pending || !!datesError} onClick={() => create(false)}>
                    Decide later
                  </Button>
                ) : null}
                <Button variant="primary" className="h-11 md:h-10" disabled={pending || !!datesError || !chosen.some((p) => p.dates.length)} onClick={() => create(true)}>
                  {pending ? 'Creating…' : 'Create trip'}
                </Button>
              </div>
            </div>
            {chosen.length && !chosen.some((p) => p.dates.length) ? <p className="-mt-3 text-right text-[12.5px] text-caution">Pick at least one ski day.</p> : null}
            {picked.length ? (
              <p className="-mt-2 text-[12.5px] text-ink-3">
                {plural(assigned.size, 'ski day')} of {plural(days.length, 'day')}: {days.filter((d) => assigned.has(d)).map((d) => dayLabel(d)).join(', ') || 'none yet'}
              </p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
