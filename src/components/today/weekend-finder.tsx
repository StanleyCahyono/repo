'use client'
/**
 * Weekend finder (brief §8): compare the feasible days in a window — availability (the window), home, budget,
 * ability, pass access, conditions and travel limits all feed the same engine as "Where to ski", ranked with YOUR
 * weights ("My weights").
 *
 * - The window lives in the URL (?fw=weekend|next-weekend|7d|14d); the server ranks it with the saved weights.
 * - Moving a slider previews the ranking at once (rankWindow — a read, nothing saved); "Save as my weights" writes
 *   them to preferences (saveWeights) with Undo in the toast. Reset returns to the saved weights.
 * - Every result says why it sits where it does: the gap to its neighbours, attributed to the factors that moved it
 *   (rank-model.ts), plus the biggest contributions. Unknown factors are named and counted below neutral.
 */
import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { CircleHelp, LoaderCircle, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ScrollRow } from '@/components/ui/scroll-row'
import { t } from '@/lib/ui/motion'
import { useToast } from '@/components/ui/toast'
import { rankWindow, saveWeights } from '@/lib/actions/today'
import { FACTOR_KEYS, FACTOR_LABEL, UNKNOWN_FACTOR_VALUE, type FactorKey, type FactorWeights } from '@/lib/domain/recommend'
import { formatLocalDate } from '@/lib/domain/time'
import type { FinderInputs } from './data'
import { plural } from './format'
import { useTodayNav } from './nav'
import { FINDER_WINDOW_LABEL, FINDER_WINDOWS, formatDates, type FinderWindow } from './params'
import { explainPosition, topContributions, weightPercents, type OptionView, type RankingView } from './rank-model'
import { SaveTripButton } from './option-actions'
import { Label } from './section'
import { LongHaulNote } from './long-haul'

const FACTOR_HINT: Record<FactorKey, string> = {
  conditions: 'Piste Conditions score for the day',
  fit: 'Your ability, travel limits, budget and companion',
  travel: 'Drive time with a winter buffer, or flying',
  cost: 'Per-person day cost, with your pass applied',
  events: 'Announced events at the resort that day',
}

const ABILITY: Record<FinderInputs['ability'], string> = {
  beginner: 'beginner',
  novice: 'novice',
  intermediate: 'intermediate',
  advanced: 'advanced',
  expert: 'expert',
}

const same = (a: FactorWeights, b: FactorWeights) => FACTOR_KEYS.every((k) => a[k] === b[k])

function WindowChips({ onChoose }: { onChoose: (w: FinderWindow) => void }) {
  const { params, navigate } = useTodayNav()
  const current = params.finder
  const choose = (w: FinderWindow) => {
    navigate({ fw: w === 'weekend' ? null : w })
    onChoose(w)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = FINDER_WINDOWS.indexOf(current)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = FINDER_WINDOWS[(i + step + FINDER_WINDOWS.length) % FINDER_WINDOWS.length]
    choose(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-fw="${next}"]`)?.focus()
  }
  return (
    <ScrollRow className="-mx-4 px-4 pb-0.5 scrollbar-thin md:mx-0 md:px-0">
      <div
        role="radiogroup"
        aria-label="Window to compare"
        onKeyDown={onKey}
        className="flex w-max items-center gap-1 rounded-full border border-divider bg-surface-2 p-0.5"
      >
        {FINDER_WINDOWS.map((w) => {
          const on = w === current
          return (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={on}
              data-fw={w}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(w)}
              className={cn(
                'relative inline-flex h-10 items-center rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 md:h-8',
                on ? 'text-teal' : 'text-ink-2 hover:text-ink',
              )}
            >
              {on ? (
                <motion.span
                  layoutId="finder-window"
                  transition={t.select}
                  aria-hidden
                  className="absolute inset-0 rounded-full border border-divider bg-surface shadow-[0_1px_2px_rgb(12_30_42/0.08)]"
                />
              ) : null}
              <span className="relative">{FINDER_WINDOW_LABEL[w]}</span>
            </button>
          )
        })}
      </div>
    </ScrollRow>
  )
}

function Sliders({ draft, onChange, disabled }: { draft: FactorWeights; onChange: (k: FactorKey, v: number) => void; disabled?: boolean }) {
  const pct = weightPercents(draft)
  return (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
      {FACTOR_KEYS.map((k) => {
        const id = `finder-w-${k}`
        return (
          <div key={k}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={id} className="text-[14px] font-medium text-ink">
                {FACTOR_LABEL[k]}
              </label>
              <span className="tnum text-[13px] font-semibold text-ink" aria-hidden>
                {pct[k]}%
              </span>
            </div>
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={5}
              value={draft[k]}
              disabled={disabled}
              aria-valuetext={`${draft[k]} of 100 — ${pct[k]}% of the ranking`}
              aria-describedby={`${id}-hint`}
              onChange={(e) => onChange(k, Number(e.target.value))}
              className="h-11 w-full cursor-pointer accent-teal md:h-6"
            />
            <p id={`${id}-hint`} className="text-[12px] leading-snug text-ink-3">
              {FACTOR_HINT[k]}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function DayCells({ o }: { o: OptionView }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`${o.name} by day`}>
      {o.days.map((d) => (
        <li
          key={d.date}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px]',
            d.best ? 'border-teal/50 bg-glacier text-teal' : d.total === null ? 'border-dashed border-divider-strong text-ink-3' : 'border-divider text-ink-2',
          )}
        >
          <span className="font-medium">{formatLocalDate(d.date, 'ccc d')}</span>
          <span className="tnum">{d.total === null ? (d.eligibility === 'excluded' ? 'not feasible' : '–') : d.total.toFixed(1)}</span>
          {d.best ? <span className="sr-only">(best day)</span> : null}
          {d.total === null && d.note ? <span className="sr-only">: {d.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

function Result({ list, i, dates }: { list: OptionView[]; i: number; dates: string[] }) {
  const o = list[i]
  const why = explainPosition(list, i).filter((l) => !/unknown and counted/.test(l))
  const top = topContributions(o, 3)
  const feasible = o.days.filter((d) => d.total !== null).length
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-3 py-3.5">
      <span aria-hidden className="font-display tnum pt-0.5 text-[20px] leading-none text-ink-3">
        {o.rank}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="sr-only">Rank {o.rank}: </span>
          <Link href={`/resorts/${o.resortId}?date=${o.date}`} className="text-[16px] font-semibold text-ink hover:text-teal hover:underline">
            {o.name}
          </Link>
          <span className="tnum text-[13px] text-ink-2">
            best {formatLocalDate(o.date)}
            {dates.length > 3 ? ` · ${feasible} of ${dates.length} days feasible` : ''}
          </span>
        </p>
        <p className={cn('mt-0.5 text-[12.5px]', o.eligibility === 'confirmed-open' ? 'text-positive' : 'text-caution')}>{o.statusNote}</p>
        {dates.length <= 3 ? <DayCells o={o} /> : null}
        {why.length ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {why.map((w) => (
              <li key={w} className="text-[13px] leading-snug text-ink-2">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="tnum mt-1 text-[12.5px] text-ink-3">
          Points: {top.map((f) => `${f.label} ${f.points.toFixed(1)}${f.known ? '' : ' (unknown)'}`).join(' · ')}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="font-display tnum text-[26px] leading-none text-ink">
          {o.total.toFixed(1)}
          <span className="sr-only"> ranking total</span>
        </span>
        <SaveTripButton resortId={o.resortId} name={o.name} from={o.date} to={o.date} skiDates={[o.date]} variant="icon" />
      </div>
    </li>
  )
}

export function WeekendFinder({
  window: fw,
  ranking,
  saved,
  inputs,
  preseason,
  demo = false,
  longHaulLimit = null,
}: {
  window: FinderWindow
  ranking: RankingView
  saved: FactorWeights
  inputs: FinderInputs
  preseason: boolean
  /** Demo mode: simulated data, labelled in the eyebrow. */
  demo?: boolean
  /** LONG_HAUL_KM in display units, for the note on resorts too far away to compare here. */
  longHaulLimit?: string | null
}) {
  const toast = useToast()
  const { pending: navPending, params } = useTodayNav()
  const [draft, setDraft] = useState<FactorWeights>(saved)
  const [preview, setPreview] = useState<RankingView | null>(null)
  const [previewing, startPreview] = useTransition()
  const [saving, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const dirty = !same(draft, saved)
  const allZero = FACTOR_KEYS.every((k) => draft[k] === 0)

  /** Preview the ranking for unsaved weights (debounced; stale answers are dropped). Nothing is written. */
  const schedulePreview = (weights: FactorWeights, w: FinderWindow) => {
    const n = ++seq.current
    window.clearTimeout(timer.current)
    if (same(weights, saved) || FACTOR_KEYS.every((k) => weights[k] === 0)) {
      setPreview(null)
      return
    }
    timer.current = window.setTimeout(() => {
      startPreview(async () => {
        const res = await rankWindow({ window: w, weights })
        if (n !== seq.current) return
        if (res.ok) {
          setPreview(res.data)
          setError(null)
        } else setError(res.error)
      })
    }, 260)
  }

  const change = (k: FactorKey, v: number) => {
    const next = { ...draft, [k]: v }
    setDraft(next)
    schedulePreview(next, params.finder)
  }

  const chooseWindow = (w: FinderWindow) => {
    if (dirty) schedulePreview(draft, w)
  }

  const shown = dirty && preview && !allZero ? preview : ranking
  const list = shown.options
  const dates = shown.dates
  const busy = previewing || navPending

  const save = () =>
    startSave(async () => {
      const res = await saveWeights(draft)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const previous = res.data.previous
      toast.show('Weights saved — “My weights” and the finder now use them', {
        undo: async () => {
          const back = await saveWeights(previous)
          if (!back.ok) toast.show(back.error, { tone: 'error' })
        },
      })
    })

  const reset = () => {
    seq.current++
    window.clearTimeout(timer.current)
    setDraft(saved)
    setPreview(null)
    setError(null)
  }

  const unknownNote = useMemo(() => {
    const counts = FACTOR_KEYS.map((k) => ({
      k,
      n: list.filter((o) => o.factors.some((f) => f.key === k && !f.known)).length,
    })).filter((x) => x.n > 0)
    if (!counts.length) return null
    return `Unknown factors count at ${UNKNOWN_FACTOR_VALUE} (below neutral), so a gap never lifts a resort: ${counts.map((x) => `${FACTOR_LABEL[x.k].toLowerCase()} unknown for ${x.n} of ${list.length}`).join(', ')}.`
  }, [list])

  const excludedBy = useMemo(() => {
    const c = { closed: 0, preseason: 0, travel: 0 }
    for (const e of shown.excluded) c[e.kind]++
    return c
  }, [shown.excluded])

  const facts = [
    `from ${inputs.home}`,
    ABILITY[inputs.ability],
    inputs.companion ? `with ${inputs.companion.name ?? 'a companion'} (${ABILITY[inputs.companion.ability]})` : null,
    inputs.dayBudget ? `day budget ${inputs.dayBudget}` : 'no day budget set',
    inputs.passes.length ? inputs.passes.join(', ') : 'no pass recorded',
    inputs.maxDriveHours !== null ? `drive ≤ ${inputs.maxDriveHours} h` : 'no drive limit',
    inputs.willingToFly ? 'flying OK' : 'no flying',
  ].filter(Boolean)

  return (
    <section aria-labelledby="finder-title" className="rounded-[14px] border border-divider bg-surface">
      <header className="flex flex-col gap-3 px-4 pt-4 pb-3 md:px-6">
        <div className="min-w-0">
          <p className="eyebrow mb-1">
            Weekend finder · {formatDates(dates)}
            {demo ? <span className="ml-2 rounded-sm bg-demo-bg px-1.5 py-0.5 tracking-normal text-demo normal-case">Demo</span> : null}
          </p>
          <h2 id="finder-title" className="text-[17px] leading-snug font-semibold text-ink">
            Compare feasible days with your weights
          </h2>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-ink-2">
            Weighing: {facts.join(' · ')}.{' '}
            <Link href="/settings" className="font-medium text-teal hover:underline">
              Change in Settings
            </Link>
          </p>
        </div>
        <WindowChips onChoose={chooseWindow} />
      </header>

      <form
        aria-labelledby="finder-weights-title"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !allZero) save()
        }}
        className="border-t border-divider bg-surface-2 px-4 py-4 md:px-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 id="finder-weights-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <SlidersHorizontal aria-hidden className="size-4 text-ink-3" /> My weights
            <span className="text-[12.5px] font-normal text-ink-3">· relative, scaled to 100%</span>
          </h3>
          <span className={cn('text-[12.5px] font-medium', dirty ? 'text-copper' : 'text-ink-3')} aria-live="polite">
            {dirty ? (allZero ? 'Give one factor some weight' : 'Previewing — not saved') : 'Saved'}
          </span>
        </div>
        <div className="mt-3">
          <Sliders draft={draft} onChange={change} disabled={saving} />
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-critical">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!dirty || allZero || saving}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-teal bg-teal px-4 text-[14px] font-medium text-on-teal transition-colors duration-150 hover:bg-teal-strong disabled:cursor-not-allowed disabled:border-divider-strong disabled:bg-surface-3 disabled:text-ink-3 md:h-10"
          >
            {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
            Save as my weights
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!dirty || saving}
            className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-50 md:h-10"
          >
            <RotateCcw aria-hidden className="size-4" /> Reset
          </button>
          <p className="text-[12.5px] text-ink-3">Moving a slider previews the ranking; nothing is saved until you choose to.</p>
        </div>
      </form>

      <div className="border-t border-divider">
        <div className={cn('min-w-0 px-4 py-4 transition-opacity duration-200 md:px-6', busy && 'opacity-60')} aria-busy={busy || undefined}>
          <div className="flex items-center justify-between gap-3">
            <Label as="h3">
              {preseason ? 'Nothing to compare yet' : `${plural(list.length, 'feasible resort')} · ${FINDER_WINDOW_LABEL[fw].toLowerCase()}`}
            </Label>
            {busy ? <LoaderCircle aria-label="Updating the ranking" className="size-4 animate-spin text-ink-3" /> : null}
          </div>
          {list.length ? (
            <ol className="divide-y divide-divider">
              {list.slice(0, 5).map((o, i) => (
                <Result key={o.resortId} list={list} i={i} dates={dates} />
              ))}
            </ol>
          ) : (
            <p className="mt-2 max-w-[60ch] text-[14px] text-ink-2">{shown.noWinnerReason ?? 'No resort can be skied in this window.'}</p>
          )}
          {list.length > 5 ? <p className="tnum mt-1 text-[12.5px] text-ink-3">+{list.length - 5} more feasible resorts rank lower.</p> : null}
          {unknownNote ? <p className="mt-2 text-[12.5px] text-ink-3">{unknownNote}</p> : null}
          {shown.unknown.length ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>
                <span className="font-medium text-ink">Status unknown — check before going:</span> {shown.unknown.map((u) => u.name).join(', ')}. Never ranked
                as feasible.
              </span>
            </p>
          ) : null}
          {shown.excluded.length ? (
            <p className="tnum mt-3 text-[12.5px] text-ink-3">
              Not feasible:{' '}
              {[
                excludedBy.closed ? `${excludedBy.closed} closed` : null,
                excludedBy.preseason ? `${excludedBy.preseason} not open yet` : null,
                excludedBy.travel ? `${excludedBy.travel} outside your travel limits` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              .
            </p>
          ) : null}
          {shown.longHaul ? <LongHaulNote count={shown.longHaul} limit={longHaulLimit} what="compared here" className="mt-2" /> : null}
        </div>
      </div>
    </section>
  )
}
