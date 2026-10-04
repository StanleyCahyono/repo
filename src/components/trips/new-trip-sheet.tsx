'use client'
/**
 * New trip, in two steps: 1) dates and party, 2) resort(s) and which days you ski where. Creates a draft with a ski
 * day per chosen date (and the checklist from your templates), then opens it so you can add travel, lodging, lessons
 * and costs. Opens from the button or from the URL (/trips?new=1&resort=alta&start=2027-02-13&end=2027-02-17) so
 * other screens can link straight into it.
 */
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
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
import { dayLabel, duration, placeLine, plural, tripDays } from './format'
import { RangeCalendar, SeasonMark } from './range-calendar'

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
      description="Where, then when. Nothing is booked from here."
      widthClass="md:w-[560px]"
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
  const initStart = pStart && isLocalDate(pStart) ? pStart : weekends[0].start
  const initEnd = pStart && isLocalDate(pStart) ? (pEnd && isLocalDate(pEnd) ? pEnd : pStart) : weekends[0].end
  // Where first, then when: the calendar marks the chosen resorts' seasons.
  const [step, setStep] = useState<1 | 2>(pResorts.length ? 2 : 1)
  const [start, setStart] = useState<string | null>(initStart)
  const [end, setEnd] = useState<string | null>(initEnd)
  const [party, setParty] = useState(Math.min(12, Math.max(1, Number(prefill.get('party')) || 1)))
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ id: string; dates: string[] }[]>(() => pResorts.map((id, k) => ({ id, dates: k === 0 ? tripDays(initStart, initEnd) : [] })))
  const [templates, setTemplates] = useState(templateCount > 0)
  const [error, setError] = useState<string | null>(null)
  const { run, pending } = useRunAction()

  const len = start && end && isLocalDate(start) && isLocalDate(end) ? daysBetween(start, end) + 1 : 0
  const datesError = !start || !end ? 'Pick a first and a last day' : len < 1 ? 'The trip ends before it starts' : len > MAX_DAYS ? `Keep a trip under ${MAX_DAYS} days` : null
  const days = useMemo(() => (datesError || !start || !end ? [] : tripDays(start, end)), [start, end, datesError])
  const past = !datesError && !!end && end < today

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? resorts.filter((r) => `${r.name} ${r.shortName} ${r.region} ${r.place ?? ''}`.toLowerCase().includes(q)) : resorts
    return list.slice(0, q ? 40 : 60)
  }, [resorts, query])
  const byId = new Map(resorts.map((r) => [r.id, r]))
  // Chosen ski days always stay inside the current dates (changing the dates never leaves days outside the trip).
  const chosen = picked.map((p) => ({ ...p, dates: p.dates.filter((d) => days.includes(d)) }))
  const assigned = new Set(chosen.flatMap((p) => p.dates))
  const tracks = picked.map((p) => byId.get(p.id)!).map((r) => ({ resortId: r.id, name: r.shortName || r.name, windows: r.seasons }))

  const toggleResort = (id: string) =>
    setPicked((p) => {
      if (p.some((x) => x.id === id)) return p.filter((x) => x.id !== id)
      if (p.length >= 6) return p
      const free = days.filter((d) => !p.some((x) => x.dates.includes(d)))
      return [...p, { id, dates: free }]
    })
  const toggleDay = (id: string, d: string) =>
    setPicked((p) => p.map((x) => (x.id === id ? { ...x, dates: x.dates.filter((y) => days.includes(y)).includes(d) ? x.dates.filter((y) => y !== d && days.includes(y)) : [...x.dates.filter((y) => days.includes(y)), d].sort() } : x)))
  const setRange = (a: string | null, b: string | null) => {
    setStart(a)
    setEnd(b)
    // With a single resort, the new days become ski days there (tap a day chip below to make it a rest day).
    if (a && b && picked.length === 1) {
      const next = tripDays(a, b)
      setPicked((p) => p.map((x) => ({ ...x, dates: [...new Set([...x.dates.filter((d) => next.includes(d)), ...next.filter((d) => !days.includes(d))])].sort() })))
    }
  }

  const create = (withResorts: boolean) => {
    if (!start || !end) return
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
    { n: 1 as const, label: 'Where' },
    { n: 2 as const, label: 'When & who' },
  ]
  const canCreate = !datesError && (!picked.length || chosen.some((p) => p.dates.length))

  return (
    <div className="flex flex-col gap-5">
      <ol className="glass grid grid-cols-2 gap-1 rounded-full p-[5px]" aria-label="Steps">
        {steps.map((s) => (
          <li key={s.n} className="relative">
            <button
              type="button"
              aria-current={step === s.n ? 'step' : undefined}
              onClick={() => setStep(s.n)}
              className={cn('relative flex h-10 w-full items-center justify-center gap-2 rounded-full text-[13.5px] font-medium transition-colors duration-150', step === s.n ? 'text-on-ink-chip' : 'text-ink-2 hover:text-ink')}
            >
              {step === s.n ? <motion.span layoutId="new-trip-step" transition={t.spring} aria-hidden className="absolute inset-0 rounded-full bg-ink-chip" /> : null}
              <span className="relative font-mono text-[12px] tracking-[0.1em] tnum">{step > s.n ? <Check aria-hidden className="inline size-3.5" /> : `0${s.n}`}</span>
              <span className="relative">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {error ? <Notice tone="error" title={error} /> : null}

      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={t.select} className="flex flex-col gap-4">
            <div>
              <p className="hud text-teal">Trip planner · new trip</p>
              <h3 className="mt-1 text-[30px] leading-[1.05] font-light tracking-[-0.03em] text-ink">{picked.length ? `Plan a trip to ${picked.map((p) => byId.get(p.id)!.shortName || byId.get(p.id)!.name).join(' + ')}.` : 'Where to?'}</h3>
            </div>
            {picked.length ? (
              <ul className="flex flex-wrap gap-2" aria-label="Chosen resorts">
                {picked.map((p) => {
                  const r = byId.get(p.id)!
                  return (
                    <motion.li key={p.id} layout initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={t.spring}>
                      <button type="button" onClick={() => toggleResort(p.id)} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink-chip pr-2.5 pl-4 text-[13.5px] font-medium text-on-ink-chip">
                        {r.name}
                        <span aria-hidden className="text-on-ink-chip-2">×</span>
                        <span className="sr-only">Remove {r.name}</span>
                      </button>
                    </motion.li>
                  )
                })}
              </ul>
            ) : null}
            <div className="flex flex-col gap-2">
              <label htmlFor={`${uid}-q`} className="hud text-ink-2">
                {picked.length ? 'Add another resort' : 'Resort'}
              </label>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
                <TextInput id={`${uid}-q`} value={query} placeholder="Search resorts, towns, regions" className="h-12 rounded-[14px] pl-10" onChange={(e) => setQuery(e.target.value)} />
              </div>
              <ul className="max-h-[min(46dvh,380px)] overflow-y-auto rounded-[18px] border border-divider bg-surface/70 scrollbar-thin" aria-label="Resorts">
                {filtered.map((r, k) => {
                  const on = picked.some((p) => p.id === r.id)
                  const first = r.seasons[0]
                  return (
                    <li key={r.id} className={cn('border-b border-divider last:border-0', k < 10 && 'piste-rise')} style={k < 10 ? ({ '--rise-delay': `${60 + k * 22}ms` } as CSSProperties) : undefined}>
                      <button type="button" aria-pressed={on} onClick={() => toggleResort(r.id)} className={cn('flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150', on ? 'bg-teal/10' : 'hover:bg-ink/[0.04]')}>
                        <span aria-hidden className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150', on ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'border-divider-strong bg-surface')}>
                          {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[14px] leading-snug font-medium text-ink">
                            {r.favorite ? <Star aria-label="Favourite" className="size-3.5 shrink-0 text-copper" fill="currentColor" /> : null}
                            <span className="truncate">{r.name}</span>
                          </span>
                          {r.place || r.region ? <span className="block truncate text-[12.5px] leading-snug text-ink-3">{placeLine(r.place, r.region)}</span> : null}
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] leading-snug text-ink-2 tnum">
                            {r.driveMinutes !== null ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <Car aria-hidden className="size-3.5 shrink-0 text-ink-3" /> {duration(r.driveMinutes)} drive
                              </span>
                            ) : r.flyVia.length ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <Plane aria-hidden className="size-3.5 shrink-0 text-ink-3" /> Fly to {r.flyVia.slice(0, 2).join(' or ')}
                              </span>
                            ) : null}
                            {first ? (
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                <SeasonMark kind={first.kind} className="w-2.5" /> {first.kind === 'estimate' ? 'Opening est.' : first.kind === 'announced' ? 'Opens' : 'Opened'} {formatLocalDate(first.from, 'd LLL')}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {!filtered.length ? <li className="px-3.5 py-4 text-[13.5px] text-ink-3">No resort matches “{query}”.</li> : null}
              </ul>
              <p className="text-[12px] text-ink-3">Drive times are one-way estimates from home. Season dates are opened, announced or a Piste estimate.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!picked.length ? (
                <Button variant="ghost" className="h-11 md:h-10" onClick={() => setStep(2)}>
                  Decide later
                </Button>
              ) : null}
              <Button variant="primary" className="h-11 md:h-10" disabled={!picked.length} onClick={() => setStep(2)}>
                Choose dates <ArrowRight aria-hidden className="size-4" />
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="s2" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={t.select} className="flex flex-col gap-5">
            <div>
              <p className="hud text-teal">Trip planner · new trip</p>
              <h3 className="mt-1 text-[30px] leading-[1.05] font-light tracking-[-0.03em] text-ink">{picked.length ? `Plan a trip to ${picked.map((p) => byId.get(p.id)!.shortName || byId.get(p.id)!.name).join(' + ')}.` : 'When are you going?'}</h3>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Upcoming weekends">
              {weekends.map((w) => {
                const on = w.start === start && w.end === end
                return (
                  <button
                    key={w.start}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRange(w.start, w.end)}
                    className={cn('inline-flex h-10 items-center rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 tnum hover:-translate-y-px', on ? 'bg-ink-chip text-on-ink-chip' : 'glass-strong text-ink')}
                  >
                    {formatLocalDate(w.start, 'ccc d')}–{formatLocalDate(w.end, 'ccc d LLL')}
                  </button>
                )
              })}
            </div>

            <div className="glass rounded-[24px] p-4 sm:p-5">
              <RangeCalendar start={start} end={end} onChange={setRange} today={today} maxDays={MAX_DAYS} tracks={tracks} label="Dates" />
            </div>
            {past ? <p className="-mt-2 text-[12.5px] font-medium text-caution">These dates are in the past.</p> : null}

            {chosen.length && days.length ? (
              <div className="flex flex-col gap-3">
                <p className="hud text-ink-2">Ski days</p>
                {chosen.map((p) => {
                  const r = byId.get(p.id)!
                  return (
                    <fieldset key={p.id} className="rounded-[18px] border border-divider bg-surface/60 p-3">
                      <legend className="sr-only">Ski days at {r.name}</legend>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[14px] font-semibold text-ink">{r.name}</p>
                        <p className="text-[12.5px] text-ink-2">{p.dates.length ? plural(p.dates.length, 'ski day') : 'Pick the days you’ll ski here'}</p>
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
                                'inline-flex h-11 min-w-[60px] flex-col items-center justify-center rounded-[14px] border px-2 text-[12px] leading-tight transition-colors duration-150 tnum',
                                on ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : elsewhere ? 'border-dashed border-divider-strong text-ink-3' : 'border-divider-strong bg-surface/70 text-ink hover:border-teal',
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
                <p className="text-[12.5px] text-ink-3">
                  {plural(assigned.size, 'ski day')} of {plural(days.length, 'day')}: {days.filter((d) => assigned.has(d)).map((d) => dayLabel(d)).join(', ') || 'none yet'}
                </p>
              </div>
            ) : null}

            <fieldset className="flex items-center justify-between gap-4">
              <legend className="sr-only">Party size</legend>
              <div>
                <p className="hud text-ink-2">Party</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">Name companions later; per-person costs count once for each person.</p>
              </div>
              <div className="glass flex items-center gap-1 rounded-full p-1">
                <button type="button" aria-label="One fewer person" disabled={party <= 1} onClick={() => setParty((p) => Math.max(1, p - 1))} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-ink/[0.06] disabled:opacity-40">
                  <Minus aria-hidden className="size-4" />
                </button>
                <output aria-live="polite" className="w-9 text-center text-[24px] leading-none font-light text-ink tnum">
                  {party}
                </output>
                <button type="button" aria-label="One more person" disabled={party >= 12} onClick={() => setParty((p) => Math.min(12, p + 1))} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-ink/[0.06] disabled:opacity-40">
                  <Plus aria-hidden className="size-4" />
                </button>
              </div>
            </fieldset>

            <Field label="Name" htmlFor={`${uid}-n`} optional hint="Suggested from the resort and dates when left empty.">
              <TextInput id={`${uid}-n`} value={name} maxLength={120} placeholder="e.g. Alta — Presidents’ Day" onChange={(e) => setName(e.target.value)} />
            </Field>

            <Checkbox
              label={templateCount ? `Start the checklist from my templates (${templateCount})` : 'Start the checklist from my templates'}
              hint={templateCount ? undefined : 'You have no checklist templates yet.'}
              checked={templates}
              disabled={!templateCount}
              onChange={(e) => setTemplates(e.target.checked)}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
              <Button variant="ghost" className="h-11 md:h-10" onClick={() => setStep(1)}>
                <ArrowLeft aria-hidden className="size-4" /> {picked.length ? 'Resorts' : 'Choose a resort'}
              </Button>
              <Button variant="primary" className="h-11 md:h-10" disabled={pending || !canCreate} onClick={() => create(picked.length > 0)}>
                {pending ? 'Creating…' : picked.length ? 'Create trip' : 'Create without a resort'}
              </Button>
            </div>
            {datesError && start ? <p className="-mt-3 text-right text-[12.5px] text-caution">{datesError}.</p> : null}
            {picked.length && !datesError && !chosen.some((p) => p.dates.length) ? <p className="-mt-3 text-right text-[12.5px] text-caution">Pick at least one ski day.</p> : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
