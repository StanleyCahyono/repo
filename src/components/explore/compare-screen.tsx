'use client'
/**
 * Side-by-side comparison of 2–4 resorts on ONE scenario (same date, scoring mode, party size, pass and rental
 * basket for every column). The scenario lives in the URL (/explore/compare?ids=a,b&date=…&mode=…&party=…&product=…).
 *
 * - ≥ lg: a real <table> (row headers, column headers with the resort, sticky header row).
 * - < lg: swipeable columns (scroll-snap) with a resort switcher that follows the swipe; every value keeps its label.
 * Both render from the same row definitions, so the two layouts can never disagree.
 *
 * "Best" tags only appear when at least two columns have a known value and one is strictly better — unknown is never
 * ranked. Every column has a Sources drawer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Award, CalendarDays, CircleCheck, CircleHelp, CircleSlash, LoaderCircle, Plane, Car, Ticket, X } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { ButtonLink } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/form'
import { KindTag, Missing } from '@/components/ui/provenance'
import { ConfidenceTag, ScoreChip } from '@/components/ui/score'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import { EmptyState, Notice } from '@/components/ui/states'
import { OpeningTag, StatusPill } from '@/components/ui/status'
import { CardPassBadges } from '@/components/resort/card-passes'
import { RESEARCH_LABEL } from '@/components/resort/card-data'
import { COMPARE_MAX, useCompareSelection } from '@/components/resort/card-compare'
import type { CompareColumn, CompareView } from '@/lib/data/explore'
import { SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'
import { readableQuery, rememberQuery } from './use-explore-url'
import { formatLocalDate } from '@/lib/domain/time'

type BestKey = keyof CompareView['best']

interface RowDef {
  key: string
  label: string
  render: (c: CompareColumn) => ReactNode
  best?: BestKey
}

interface SectionDef {
  key: string
  title: string
  note?: string
  rows: RowDef[]
}

export function CompareScreen({ view }: { view: CompareView }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const compare = useCompareSelection()
  const cols = view.columns

  // Keep the tray in step with what is being compared (the URL is the source of truth here).
  const { set: setSelection } = compare
  const signature = cols.map((c) => c.id).join(',')
  useEffect(() => {
    if (cols.length) setSelection(cols.map((c) => ({ id: c.id, name: c.card.shortName })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, setSelection])
  useEffect(() => {
    rememberQuery('compare', window.location.search)
  }, [signature, view.date, view.mode, view.party, view.product?.id])

  const navigate = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') p.delete(k)
        else p.set(k, v)
      }
      start(() => router.replace(`${pathname}?${readableQuery(p)}`, { scroll: false }))
    },
    [pathname, router],
  )
  const removeColumn = (id: string) => {
    const ids = cols.map((c) => c.id).filter((x) => x !== id)
    compare.remove(id)
    navigate({ ids: ids.join(',') || null })
  }

  const sections = useMemo(() => buildSections(view), [view])

  const addResort = (id: string) => navigate({ ids: [...cols.map((c) => c.id), id].join(',') })

  if (cols.length < 2) {
    return <NotEnough view={view} onAdd={addResort} pending={pending} />
  }

  return (
    <div className="flex flex-col gap-5">
      <ScenarioForm view={view} pending={pending} onChange={navigate} />

      {view.missingIds.length || view.droppedIds.length ? (
        <Notice tone="info" title="Some resorts are not shown">
          {view.missingIds.length ? <>Not in the catalog: {view.missingIds.join(', ')}. </> : null}
          {view.droppedIds.length ? <>Compare shows up to four — left out: {view.droppedIds.join(', ')}.</> : null}
        </Notice>
      ) : null}

      <Highlights view={view} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-2">
          <span className="tnum font-semibold text-ink">{cols.length}</span> of {COMPARE_MAX} columns · every column uses the scenario above
        </p>
        {cols.length < COMPARE_MAX ? (
          <AddResort candidates={view.candidates} onAdd={addResort} disabled={pending} />
        ) : (
          <p className="text-[12.5px] text-ink-3">Compare holds four — remove one to add another.</p>
        )}
      </div>

      <div aria-busy={pending || undefined} className={cn('transition-opacity duration-200', pending && 'pointer-events-none opacity-55')}>
        <CompareTable view={view} sections={sections} onRemove={removeColumn} />
        <CompareColumns view={view} sections={sections} onRemove={removeColumn} />
      </div>

      <p className="text-[12.5px] text-ink-3">
        Scores describe suitability for the day, not safety. Prices are Piste estimates from recorded snapshots — confirm at the source before buying. Unknown
        values are never ranked.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenario

function ScenarioForm({ view, pending, onChange }: { view: CompareView; pending: boolean; onChange: (p: Record<string, string | null>) => void }) {
  const productGroups = useMemo(() => {
    const m = new Map<string, CompareView['products']>()
    for (const p of view.products.filter((x) => !x.owned)) m.set(p.familyName, [...(m.get(p.familyName) ?? []), p])
    return [...m.entries()]
  }, [view.products])
  const owned = view.products.filter((p) => p.owned)
  const field = 'flex min-w-0 flex-col gap-1.5'
  const label = 'text-[12.5px] font-medium text-ink-2'
  // Phones: a one-line summary with "Change", so the columns start near the top; wider screens show the fields.
  const [editing, setEditing] = useState(false)
  const passLabel = view.product ? view.product.name : view.owned.length ? 'your passes' : 'no pass (tickets)'
  return (
    <section aria-labelledby="compare-scenario" className="rounded-[12px] border border-divider bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="compare-scenario" className="text-[15px] font-semibold text-ink">
          Same scenario for every column
        </h2>
        <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
          {pending ? (
            <>
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> Updating…
            </>
          ) : (
            <span className="max-md:hidden">Rental: {view.rentalLabel.toLowerCase()} · change it in Settings</span>
          )}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 md:hidden">
        <p className="tnum min-w-0 text-[13.5px] text-ink">
          {view.dateLabel.replace(/ \d{4}$/, '')} · {view.modeLabel} · {view.party === 1 ? '1 person' : `${view.party} people`} · {passLabel}
        </p>
        <button
          type="button"
          aria-expanded={editing}
          aria-controls="cmp-scenario-fields"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex h-11 shrink-0 items-center rounded-md border border-divider-strong bg-surface px-3 text-[13.5px] font-medium text-ink hover:border-teal hover:text-teal"
        >
          {editing ? 'Done' : 'Change'}
        </button>
      </div>
      <div id="cmp-scenario-fields" className={cn('mt-3 grid grid-cols-2 gap-3 md:grid-cols-4', !editing && 'max-md:hidden')}>
        <div className={field}>
          <label htmlFor="cmp-date" className={label}>
            Day
          </label>
          <input
            id="cmp-date"
            type="date"
            min={view.seasonBounds.min}
            max={view.seasonBounds.max}
            value={view.date}
            onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && onChange({ date: e.target.value === view.today ? null : e.target.value })}
            className="tnum h-11 w-full rounded-md border border-divider-strong bg-surface px-3 text-[15px] text-ink hover:border-ink-3 focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-1 md:h-10"
          />
        </div>
        <div className={field}>
          <label htmlFor="cmp-mode" className={label}>
            Score for
          </label>
          <Select id="cmp-mode" value={view.mode} onChange={(e) => onChange({ mode: e.target.value })}>
            {SCORING_MODES.map((m: ScoringMode) => (
              <option key={m} value={m}>
                {SCORING_MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className={field}>
          <label htmlFor="cmp-party" className={label}>
            Party
          </label>
          <Select id="cmp-party" value={String(view.party)} onChange={(e) => onChange({ party: e.target.value === '1' ? null : e.target.value })}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 person' : `${n} people`}
              </option>
            ))}
          </Select>
        </div>
        <div className={field}>
          <label htmlFor="cmp-pass" className={label}>
            Pass
          </label>
          <Select id="cmp-pass" value={view.product?.id ?? ''} onChange={(e) => onChange({ product: e.target.value || null })}>
            <option value="">{view.owned.length ? 'Your passes' : 'No pass (tickets)'}</option>
            {owned.length ? (
              <optgroup label="Your passes">
                {owned.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {productGroups.map(([fam, list]) => (
              <optgroup key={fam} label={fam}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </div>
    </section>
  )
}

/** The decision in one line: who leads on score, cost, drive and beginner terrain (only when known and distinct). */
function Highlights({ view }: { view: CompareView }) {
  const name = (id: string | null) => (id ? (view.columns.find((c) => c.id === id)?.card.shortName ?? id) : null)
  const items: { label: string; value: string | null; detail: string | null }[] = [
    {
      label: `Best conditions (${view.modeLabel.toLowerCase()})`,
      value: name(view.best.score),
      detail: view.best.score ? `${view.columns.find((c) => c.id === view.best.score)?.score.value} / 100` : null,
    },
    {
      label: 'Lowest day cost',
      value: name(view.best.cost),
      detail: view.best.cost ? (view.columns.find((c) => c.id === view.best.cost)?.cost.total ?? null) : null,
    },
    {
      label: 'Shortest drive',
      value: name(view.best.drive),
      detail: view.best.drive ? (view.columns.find((c) => c.id === view.best.drive)?.travel.drive?.text ?? null) : null,
    },
    {
      label: 'Most beginner terrain',
      value: name(view.best.beginner),
      detail: view.best.beginner ? `${view.columns.find((c) => c.id === view.best.beginner)?.terrain.beginnerPct}%` : null,
    },
  ]
  return (
    <section aria-label="Highlights" className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-divider bg-divider md:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
          <span className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{i.label}</span>
          {i.value ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold text-ink">{i.value}</span>
              {i.detail ? <span className="tnum shrink-0 text-[13px] text-ink-2">{i.detail}</span> : null}
            </span>
          ) : (
            <span className="text-[13.5px] text-ink-3 italic">No clear leader</span>
          )}
        </div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Layouts

function ColumnHead({ c, onRemove }: { c: CompareColumn; onRemove: (id: string) => void }) {
  const r = c.card
  const sources: SourceItem[] = [
    ...r.sources,
    ...c.access.rows.map((a) => ({ label: `Pass: ${a.productName}`, value: `${a.statusLabel} — ${a.headline}`, prov: a.prov })),
    ...c.hours.rows.map((h) => ({ label: `Hours: ${h.label}`, value: h.text, prov: h.prov })),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={r.href} className="text-[15.5px] leading-snug font-semibold text-ink hover:text-teal hover:underline">
            {r.name}
          </Link>
          <p className="truncate text-[12.5px] text-ink-2">{r.place}</p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(c.id)}
          aria-label={`Remove ${r.name} from the comparison`}
          title="Remove from comparison"
          className="-mt-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink md:size-8"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={r.status.status} size="sm" />
        {r.demo ? (
          <Badge tone="demo" className="h-5 px-1.5">
            Demo
          </Badge>
        ) : null}
        <SourceDrawer title={`${r.name} — sources`} items={sources} label="Sources" compact={false} />
      </div>
    </div>
  )
}

function CompareTable({ view, sections, onRemove }: { view: CompareView; sections: SectionDef[]; onRemove: (id: string) => void }) {
  const cols = view.columns
  return (
    <div className="hidden lg:block">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Comparison of {cols.map((c) => c.card.name).join(', ')} for {view.dateLabel}, {view.modeLabel}, party of {view.party}
        </caption>
        <colgroup>
          <col className="w-[190px] xl:w-[210px]" />
          {cols.map((c) => (
            <col key={c.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="sticky top-0 z-10 border-b border-divider-strong bg-canvas" />
            {cols.map((c) => (
              <th key={c.id} scope="col" className="sticky top-0 z-10 border-b border-divider-strong bg-canvas px-4 pt-3 pb-3 align-top font-normal">
                <ColumnHead c={c} onRemove={onRemove} />
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.key}>
            <tr>
              <th colSpan={cols.length + 1} scope="colgroup" className="px-0 pt-6 pb-2 text-left">
                <span className="text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{s.title}</span>
                {s.note ? <span className="ml-2 text-[12.5px] font-normal text-ink-3 normal-case">{s.note}</span> : null}
              </th>
            </tr>
            {s.rows.map((row, i) => (
              <tr key={row.key} className="align-top">
                <th
                  scope="row"
                  className={cn(
                    'border-divider bg-surface-2 px-4 py-3 text-[13px] font-medium text-ink-2',
                    'border-l',
                    i === 0 ? 'rounded-tl-[10px] border-t' : '',
                    i === s.rows.length - 1 ? 'rounded-bl-[10px] border-b' : 'border-b',
                  )}
                >
                  {row.label}
                </th>
                {cols.map((c, ci) => (
                  <td
                    key={c.id}
                    className={cn(
                      'border-b border-l border-divider bg-surface px-4 py-3 text-[13.5px] text-ink',
                      i === 0 && 'border-t',
                      ci === cols.length - 1 && 'border-r',
                      ci === cols.length - 1 && i === 0 && 'rounded-tr-[10px]',
                      ci === cols.length - 1 && i === s.rows.length - 1 && 'rounded-br-[10px]',
                    )}
                  >
                    <Cell row={row} c={c} view={view} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function CompareColumns({ view, sections, onRemove }: { view: CompareView; sections: SectionDef[]; onRemove: (id: string) => void }) {
  const cols = view.columns
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const root = scroller.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index))
      },
      { root, threshold: 0.6 },
    )
    root.querySelectorAll('[data-index]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [cols.length])

  const go = (i: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }

  return (
    <div className="lg:hidden">
      <div className="sticky top-14 z-10 -mx-4 flex items-center gap-2 border-b border-divider bg-canvas px-4 py-2 md:top-0 md:-mx-8 md:px-8">
        <div role="tablist" aria-label="Resorts in this comparison" className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-thin">
          {cols.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-controls={`cmp-col-${c.id}`}
              onClick={() => go(i)}
              className={cn(
                'relative inline-flex h-11 shrink-0 items-center rounded-md px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150',
                i === active ? 'text-teal' : 'text-ink-2 hover:text-ink',
              )}
            >
              {i === active ? (
                <motion.span layoutId="cmp-active-col" transition={t.select} aria-hidden className="absolute inset-0 rounded-md bg-glacier" />
              ) : null}
              <span className="relative">{c.card.shortName}</span>
            </button>
          ))}
        </div>
        <span className="tnum shrink-0 text-[12.5px] text-ink-3" aria-hidden>
          {active + 1}/{cols.length}
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => go(Math.max(0, active - 1))}
            disabled={active === 0}
            aria-label="Previous resort"
            className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink-2 disabled:opacity-40"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(Math.min(cols.length - 1, active + 1))}
            disabled={active === cols.length - 1}
            aria-label="Next resort"
            className="inline-flex size-11 items-center justify-center rounded-md border border-divider-strong bg-surface text-ink-2 disabled:opacity-40"
          >
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        // `relative` makes the scroller the containing block of its absolutely positioned (sr-only) descendants, so
        // they are clipped with the columns instead of widening the page on phones.
        className="relative -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 scrollbar-thin md:-mx-8 md:scroll-px-8 md:px-8"
      >
        {cols.map((c, i) => (
          <section
            key={c.id}
            id={`cmp-col-${c.id}`}
            data-index={i}
            role="tabpanel"
            aria-label={c.card.name}
            className="w-[86%] max-w-[26rem] shrink-0 snap-start rounded-[12px] border border-divider bg-surface"
          >
            <div className="border-b border-divider p-4">
              <ColumnHead c={c} onRemove={onRemove} />
            </div>
            {sections.map((s) => (
              <div key={s.key} className="border-b border-divider px-4 py-3 last:border-b-0">
                <h3 className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{s.title}</h3>
                <dl className="flex flex-col gap-3">
                  {s.rows.map((row) => (
                    <div key={row.key} className="flex flex-col gap-1">
                      <dt className="text-[12.5px] font-medium text-ink-3">{row.label}</dt>
                      <dd className="text-[13.5px] text-ink">
                        <Cell row={row} c={c} view={view} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function Cell({ row, c, view }: { row: RowDef; c: CompareColumn; view: CompareView }) {
  const best = row.best && view.best[row.best] === c.id
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {row.render(c)}
      {best ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-positive-bg px-1.5 py-0.5 text-[12px] font-semibold text-positive">
          <Award aria-hidden className="size-3.5" /> Best of these
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows

function buildSections(view: CompareView): SectionDef[] {
  const date = view.dateLabel.replace(/ \d{4}$/, '')
  return [
    {
      key: 'conditions',
      title: `Conditions · ${date}`,
      note: view.modeLabel,
      rows: [
        { key: 'score', label: 'Conditions score', best: 'score', render: ScoreCell },
        { key: 'components', label: 'Score components', render: ComponentsCell },
        { key: 'why', label: 'Why', render: WhyCell },
        { key: 'snow', label: 'Snow', render: SnowCell },
      ],
    },
    {
      key: 'learning',
      title: 'Learning & terrain',
      rows: [
        { key: 'learning', label: 'Learning suitability', render: (c) => <LearningCell c={c} /> },
        { key: 'terrain', label: 'Beginner terrain', best: 'beginner', render: (c) => <TerrainCell c={c} /> },
        {
          key: 'lessons',
          label: 'Lessons · rentals',
          render: (c) => (
            <span className="flex flex-col gap-0.5">
              <Tri value={c.lessons} label="Lessons" />
              <Tri value={c.rentals} label="Rentals" />
            </span>
          ),
        },
      ],
    },
    {
      key: 'season',
      title: 'Season & hours',
      rows: [
        { key: 'opening', label: 'Opening & closing', render: (c) => <OpeningCell c={c} /> },
        { key: 'hours', label: `Hours on ${date}`, render: (c) => <HoursCell c={c} /> },
      ],
    },
    {
      key: 'access',
      title: `Pass access · ${date}`,
      note: view.product ? view.product.name : view.owned.length ? 'Your passes' : undefined,
      rows: [
        {
          key: 'families',
          label: 'Pass families',
          render: (c) =>
            c.card.passes.length ? <CardPassBadges passes={c.card.passes} seasonLabel={c.card.seasonLabel} /> : <Missing label="None recorded" />,
        },
        { key: 'access', label: 'Can you ski on it?', render: (c) => <AccessCell c={c} /> },
      ],
    },
    {
      key: 'cost',
      title: 'Day cost',
      note: `per person · ${view.rentalLabel.toLowerCase()} · lunch · parking${view.party > 1 ? ` · party of ${view.party}` : ''}`,
      rows: [
        { key: 'total', label: 'Day basket', best: 'cost', render: (c) => <CostTotalCell c={c} /> },
        { key: 'lines', label: 'Line items', render: (c) => <CostLinesCell c={c} /> },
      ],
    },
    {
      key: 'travel',
      title: 'Travel from home',
      rows: [
        { key: 'drive', label: 'Drive', best: 'drive', render: (c) => <DriveCell c={c} /> },
        { key: 'fly', label: 'Fly', render: (c) => <FlyCell c={c} /> },
      ],
    },
    {
      key: 'stay',
      title: 'Stay & events',
      rows: [
        { key: 'lodging', label: 'Lodging', render: (c) => <LodgingCell c={c} /> },
        { key: 'events', label: `Events near ${date}`, render: (c) => <EventsCell c={c} /> },
      ],
    },
    {
      key: 'gaps',
      title: 'What we do not know',
      rows: [{ key: 'gaps', label: 'Data gaps', render: (c) => <GapsCell c={c} /> }],
    },
  ]
}

function ScoreCell(c: CompareColumn) {
  const s = c.score
  return (
    <span className="flex flex-col gap-1">
      <ScoreChip scoreKind={s.kind} score={s.value} coverage={s.coverage} size="md" />
      {s.kind === 'conditions' && s.confidence ? <ConfidenceTag confidence={s.confidence as 'high' | 'medium' | 'low'} /> : null}
      {s.kind !== 'conditions' ? <span className="text-[12.5px] text-ink-3">{s.caption}</span> : null}
      {s.surface ? (
        <span className="text-[12.5px] text-ink-2">
          {s.surface}
          {s.surfaceBasis === 'reported' ? <span className="text-ink-3"> · reported</span> : null}
        </span>
      ) : null}
    </span>
  )
}

function ComponentsCell(c: CompareColumn) {
  const comps = c.score.components
  if (c.score.kind === 'closed') return <span className="text-[13px] text-ink-2">Not scored — closed on this day</span>
  if (!comps.length) return <Missing label="No assessment for this day" />
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Score components (0–100, share of the weight)">
      {comps.map((k) => (
        <li key={k.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5" title={k.note ?? undefined}>
          <span className="truncate text-[12.5px] text-ink-2">{k.label}</span>
          <span className="tnum text-[12.5px] font-semibold text-ink">
            {k.value === null || !k.included ? <span className="font-normal text-ink-3 italic">no data</span> : k.value}
          </span>
          <span aria-hidden className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-3">
            {k.value !== null && k.included ? (
              <motion.span
                className="block h-full rounded-full bg-teal"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.max(0.02, k.value / 100) }}
                transition={t.bars}
                style={{ originX: 0 }}
              />
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function WhyCell(c: CompareColumn) {
  if (!c.score.explanation.length) return <Missing label="No explanation — no assessment" />
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12.5px] text-ink-2 marker:text-ink-3">
      {c.score.explanation.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  )
}

function SnowCell(c: CompareColumn) {
  const rep = c.card.snow.reported
  const mod = c.card.snow.modeled
  if (!rep && !mod) return <Missing label={c.card.snow.missing ?? 'No snow information'} />
  return (
    <span className="flex flex-col gap-1">
      {rep ? (
        <span>
          <span className="tnum font-semibold">{rep.headline}</span>{' '}
          <span className={cn('text-[12.5px]', rep.stale ? 'text-caution' : 'text-ink-3')}>
            <KindTag kind={rep.kind} className="mx-0.5 align-[-2px]" /> {[rep.detail, rep.age].filter(Boolean).join(' · ')}
          </span>
        </span>
      ) : (
        <span className="text-[12.5px] text-ink-3">No snow report on file</span>
      )}
      {mod ? (
        <span className="text-[12.5px] text-ink-2">
          <KindTag kind="modeled" className="mr-1 align-[-2px]" />
          {mod.headline} · next 72 h
        </span>
      ) : null}
    </span>
  )
}

function LearningCell({ c }: { c: CompareColumn }) {
  const tone =
    c.learning.level === 'good'
      ? 'text-positive'
      : c.learning.level === 'limited'
        ? 'text-caution'
        : c.learning.level === 'unknown'
          ? 'text-ink-3 italic'
          : 'text-ink'
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn('font-semibold', tone)}>{c.learning.label}</span>
      <span className="text-[12.5px] text-ink-2">{c.learning.reason}</span>
    </span>
  )
}

function TerrainCell({ c }: { c: CompareColumn }) {
  const tr = c.terrain
  if (tr.beginnerPct === null && tr.intermediatePct === null && tr.advancedPct === null) return <Missing label="Terrain split unknown" />
  const parts = [
    { k: 'Beginner', v: tr.beginnerPct, cls: 'bg-positive' },
    { k: 'Intermediate', v: tr.intermediatePct, cls: 'bg-info' },
    { k: 'Advanced', v: tr.advancedPct, cls: 'bg-ink' },
  ]
  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-display tnum text-[24px] leading-none text-ink">{tr.beginnerPct === null ? '—' : `${tr.beginnerPct}%`}</span>
      <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
        {parts.map((p) => (p.v !== null ? <span key={p.k} className={cn('h-full', p.cls)} style={{ width: `${p.v}%` }} /> : null))}
      </span>
      <span className="tnum text-[12px] text-ink-2">{parts.map((p) => `${p.k.toLowerCase()} ${p.v === null ? 'unknown' : `${p.v}%`}`).join(' · ')}</span>
      {tr.beginnerArea ? <span className="line-clamp-2 text-[12px] text-ink-3">{tr.beginnerArea}</span> : null}
      {tr.researched ? <span className="text-[12px] font-medium text-caution">Researched split — confirm at source</span> : null}
    </span>
  )
}

function Tri({ value, label }: { value: boolean | null; label: string }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-positive">
        <CircleCheck aria-hidden className="size-3.5" /> {label} offered
      </span>
    )
  if (value === false)
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <CircleSlash aria-hidden className="size-3.5" /> {label} not offered
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-3 italic">
      <CircleHelp aria-hidden className="size-3.5 not-italic" /> {label}: unknown
    </span>
  )
}

function OpeningCell({ c }: { c: CompareColumn }) {
  const s = c.season
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <OpeningTag label={s.openingLabel as 'announced' | 'estimated' | 'opened' | 'not-announced'} />
        <span className="tnum">{s.openingText}</span>
      </span>
      <span className="tnum text-[12.5px] text-ink-2">{s.closingText}</span>
      {s.announcedOn ? <span className="tnum text-[12px] text-ink-3">Announced {formatLocalDate(s.announcedOn, 'd LLL yyyy')}</span> : null}
    </span>
  )
}

function HoursCell({ c }: { c: CompareColumn }) {
  const h = c.hours
  return (
    <span className="flex flex-col gap-1">
      {h.rows.length ? (
        <ul className="flex flex-col gap-0.5">
          {h.rows.map((row) => (
            <li key={`${row.label}-${row.activity}`} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-[12.5px] text-ink-2">{row.activity}</span>
              <span className="tnum font-medium">{row.text}</span>
              <span className="text-[12px] text-ink-3">
                {h.zoneAbbrev} · {row.nature === 'live' ? 'reported today' : 'published'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Missing label="Not published" />
      )}
      {h.note ? <span className="text-[12px] text-ink-3">{h.note}</span> : null}
    </span>
  )
}

function AccessCell({ c }: { c: CompareColumn }) {
  if (!c.access.rows.length) return <span className="text-[12.5px] text-ink-2">{c.access.note ?? 'No pass to check'}</span>
  return (
    <ul className="flex flex-col gap-2">
      {c.access.rows.map((a) => (
        <li key={a.productId} className="flex flex-col gap-0.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-semibold',
              a.canSki ? 'text-positive' : a.status === 'unknown' ? 'text-caution' : 'text-ink-2',
            )}
          >
            <Ticket aria-hidden className="size-3.5 shrink-0" />
            {a.productName}
            {a.owned ? <span className="text-[12px] font-normal text-ink-3">(yours)</span> : null}
          </span>
          <span className="text-[13px]">{a.headline}</span>
          {a.reservation ? <span className="text-[12px] text-ink-3">{a.reservation}</span> : null}
          {a.confirmAtSource ? <span className="text-[12px] font-medium text-caution">Confirm at source</span> : null}
        </li>
      ))}
    </ul>
  )
}

function CostTotalCell({ c }: { c: CompareColumn }) {
  const k = c.cost
  if (k.tier === 'incomplete' || !k.total) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-ink-2">Incomplete estimate</span>
        {k.missing.length ? <span className="text-[12.5px] text-ink-3">{k.missing.slice(0, 2).map((m) => m.replace(/\.$/, '')).join(' · ')}</span> : null}
        <span className="text-[12px] text-ink-3">{k.dayType}</span>
      </span>
    )
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-2">
        <span className="font-display tnum text-[24px] leading-none text-copper">{k.label}</span>
        <span className="tnum font-semibold">≈ {k.total}</span>
      </span>
      <span className="text-[12px] text-ink-3">
        {k.dayType} · Piste estimate{k.passNote ? ` · ${k.passNote}` : ''}
      </span>
    </span>
  )
}

function CostLinesCell({ c }: { c: CompareColumn }) {
  return (
    <span className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1">
        {c.cost.lines.map((l) => (
          <li key={l.key} className="grid grid-cols-[1fr_auto] gap-x-2">
            <span className="min-w-0 text-[12.5px] text-ink-2">
              {l.label}
              {l.kindLabel ? <span className="text-ink-3"> · {l.kindLabel}</span> : null}
            </span>
            <span className="tnum text-right text-[12.5px] font-medium">{l.amount ?? <Missing label="Unknown" className="text-[12.5px]" />}</span>
            {l.note ? <span className="col-span-2 text-[12px] text-ink-3">{l.note}</span> : null}
          </li>
        ))}
      </ul>
      {c.cost.caveats.length ? <span className="text-[12px] text-ink-3">{c.cost.caveats[0]}</span> : null}
    </span>
  )
}

function DriveCell({ c }: { c: CompareColumn }) {
  const d = c.travel.drive
  if (!d) return <Missing label={c.travel.mode === 'fly' ? 'No drive estimate — fly-in' : 'Unknown'} />
  return (
    <span className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Car aria-hidden className="size-4 text-ink-3" />
        <span className="font-display tnum text-[24px] leading-none">{d.text}</span>
      </span>
      <span className="text-[12px] text-ink-3">{d.estimate ? 'Curated estimate, not live routing' : 'Routed'}</span>
      {d.winterText ? <span className="tnum text-[12px] text-ink-2">{d.winterText}</span> : null}
    </span>
  )
}

function FlyCell({ c }: { c: CompareColumn }) {
  const f = c.travel.fly
  if (!f) return <Missing label="No airport recorded" />
  return (
    <span className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Plane aria-hidden className="size-4 text-ink-3" />
        {f.iata}
        {f.name ? <span className="truncate font-normal text-ink-2">{f.name}</span> : null}
      </span>
      <span className="text-[12px] text-ink-3">
        {f.role === 'closest' ? 'Closest airport' : 'Practical airport'} · {f.transferText}
      </span>
      <span className="text-[12px] text-ink-2">{c.travel.verdict}</span>
    </span>
  )
}

function LodgingCell({ c }: { c: CompareColumn }) {
  const l = c.lodging
  return (
    <span className="flex flex-col gap-0.5">
      {l.curated ? (
        <span>
          <span className="tnum font-semibold">{l.curated}</span> curated {l.curated === 1 ? 'stay' : 'stays'}
          <span className="text-[12.5px] text-ink-3"> · {l.byTier.map((x) => `${x.count} ${x.tier}`).join(', ')}</span>
        </span>
      ) : (
        <Missing label="No curated stays yet" />
      )}
      <Tri value={l.onMountain} label="On-mountain lodging" />
      {l.skiInOutVerified ? <span className="text-[12px] text-ink-2">{l.skiInOutVerified} verified ski-in/ski-out</span> : null}
      <span className="text-[12px] text-ink-3">Room prices: check rates with the property</span>
    </span>
  )
}

function EventsCell({ c }: { c: CompareColumn }) {
  const e = c.events
  return (
    <span className="flex flex-col gap-1">
      {e.inWindow.length ? (
        <ul className="flex flex-col gap-1">
          {e.inWindow.map((x) => (
            <li key={x.title} className="flex items-start gap-1.5">
              <CalendarDays aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              <span>
                <span className="font-medium">{x.title}</span>
                <span className="text-[12.5px] text-ink-2">
                  {' '}
                  · {x.when} · {x.statusLabel}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12.5px] text-ink-2">None within 3 days</span>
      )}
      {e.upcoming || e.watching ? (
        <span className="text-[12px] text-ink-3">
          {e.upcoming ? `${e.upcoming} upcoming` : ''}
          {e.upcoming && e.watching ? ' · ' : ''}
          {e.watching ? `${e.watching} awaiting dates` : ''}
          {' · '}
          <Link href={`/explore/events?resort=${c.id}`} className="font-medium text-teal hover:underline">
            Events
          </Link>
        </span>
      ) : null}
    </span>
  )
}

function GapsCell({ c }: { c: CompareColumn }) {
  const research = c.card.research
  return (
    <span className="flex flex-col gap-1">
      {research ? <span className="text-[12.5px] font-medium text-caution">{RESEARCH_LABEL[research].short}</span> : null}
      {c.gaps.length ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12.5px] text-ink-2 marker:text-ink-3">
          {c.gaps.slice(0, 4).map((g) => (
            <li key={g}>{g}</li>
          ))}
          {c.gaps.length > 4 ? <li className="text-ink-3">+{c.gaps.length - 4} more on the resort page</li> : null}
        </ul>
      ) : (
        <span className="text-[12.5px] text-ink-2">No known gaps for this day</span>
      )}
    </span>
  )
}

/** "Add a resort" picker (favourites first). Choosing navigates; the tray follows the URL. */
function AddResort({ candidates, onAdd, disabled }: { candidates: CompareView['candidates']; onAdd: (id: string) => void; disabled?: boolean }) {
  const favs = candidates.filter((c) => c.favorite)
  const rest = candidates.filter((c) => !c.favorite)
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="cmp-add" className="shrink-0 text-[13.5px] font-medium text-ink-2">
        Add a resort
      </label>
      <div className="w-[min(15rem,60vw)]">
        <Select id="cmp-add" value="" disabled={disabled || !candidates.length} onChange={(e) => e.target.value && onAdd(e.target.value)}>
          <option value="">Choose…</option>
          {favs.length ? (
            <optgroup label="Favourites">
              {favs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={favs.length ? 'All resorts' : 'Resorts'}>
            {rest.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.region}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fewer than two resorts

function NotEnough({ view, onAdd, pending }: { view: CompareView; onAdd: (id: string) => void; pending: boolean }) {
  const compare = useCompareSelection()
  // Offer the tray's picks when they differ from what this URL asked for (e.g. the Compare tab without ids).
  const trayReady = compare.ids.length >= 2 && compare.ids.join(',') !== view.columns.map((c) => c.id).join(',')
  const trayHref = `/explore/compare?${readableQuery(new URLSearchParams({ ids: compare.ids.join(','), date: view.date, mode: view.mode }))}`
  return (
    <div className="flex flex-col gap-4">
      {view.missingIds.length ? (
        <Notice tone="info" title="Not in the catalog">
          {view.missingIds.join(', ')} — check the link, or pick resorts from Explore.
        </Notice>
      ) : null}
      <EmptyState
        seed="compare-empty"
        title={view.columns.length === 1 ? `Add at least one more resort to compare with ${view.columns[0].card.name}` : 'Pick two to four resorts to compare'}
        body={
          <>
            Use <strong className="font-semibold text-ink">Compare</strong> on any resort card in Explore (or on a resort page). Every column then uses the same
            day, scoring mode, party and pass.
          </>
        }
        action={
          <div className="flex flex-col items-center gap-3">
            <AddResort candidates={view.candidates} onAdd={onAdd} disabled={pending} />
            <div className="flex flex-wrap justify-center gap-2">
              {trayReady ? (
                <ButtonLink href={trayHref} variant="primary">
                  Compare your {compare.ids.length} picks
                </ButtonLink>
              ) : null}
              <ButtonLink href="/explore" variant={trayReady ? 'secondary' : 'primary'}>
                Choose resorts in Explore
              </ButtonLink>
            </div>
          </div>
        }
      />
    </div>
  )
}
