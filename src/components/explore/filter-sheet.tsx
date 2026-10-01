'use client'
/**
 * All Explore filters in one sheet (bottom sheet on phones, right drawer from md). Changes apply immediately —
 * the list behind updates and the footer button says how many resorts match — so "Show N resorts" only closes.
 *
 * Every option shows how many resorts it would leave (facet count). Tri-state features offer "Unknown" as its own
 * answer so "not recorded" is never confused with "not offered".
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Select } from '@/components/ui/form'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/ui/cn'
import type { ExploreRow, ExploreView } from '@/lib/data/explore'
import { EXPENSE_TIERS, SCORING_MODES, SCORING_MODE_LABEL, type ScoringMode } from '@/lib/domain/types'
import { ChoiceGroup, ToggleChips, type ChoiceOption } from './choice-group'
import {
  FEATURES,
  FEATURE_LABEL,
  SCORE_OPTIONS,
  STATUSES,
  STATUS_FILTER_LABEL,
  TRAVELS,
  TRAVEL_LABEL,
  activeCount,
  clearFilters,
  countWith,
  type ExploreFilters,
  type FeatureKey,
  type StatusFilter,
  type TravelFilter,
  type TriState,
} from './filters'

type Setter = (next: ExploreFilters | ((cur: ExploreFilters) => ExploreFilters)) => void

export function FilterSheet({
  view,
  filters: f,
  setFilters,
  resultCount,
  open,
  onOpenChange,
  onMode,
  trigger,
}: {
  view: ExploreView
  filters: ExploreFilters
  setFilters: Setter
  resultCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Scoring mode change (phones set it here; wider screens use the scenario bar). */
  onMode: (mode: ScoringMode) => void
  trigger?: ReactNode
}) {
  const rows: ExploreRow[] = view.rows
  const n = activeCount(f)
  const count = (patch: Partial<ExploreFilters>) => countWith(rows, f, patch)
  const patch = (p: Partial<ExploreFilters>) => setFilters((cur) => ({ ...cur, ...p }))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      side="responsive"
      widthClass="md:w-[460px]"
      title="Filter resorts"
      description={`Facts for ${view.dateLabel} · ${view.modeLabel}. Changes apply as you go.`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setFilters(clearFilters)} disabled={n === 0 && !f.includeUnknown} className="h-11 md:h-10">
            Clear all
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)} className="h-11 min-w-[11rem] md:h-10">
            Show {resultCount} {resultCount === 1 ? 'resort' : 'resorts'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-7 pb-2">
        <div className="md:hidden">
          <Section title="Scenario">
            <ChoiceGroup<ScoringMode>
              label="Score for"
              description="The conditions score weighs the day differently for each mode."
              options={SCORING_MODES.map((m) => ({ value: m, label: SCORING_MODE_LABEL[m] }))}
              value={view.mode}
              onChange={(m) => onMode(m)}
            />
          </Section>
        </div>

        <Section title="Where">
          <div className="flex flex-col gap-4">
            {view.regionGroups.map((g) => (
              <ToggleChips
                key={g.group}
                label={g.group}
                options={g.regions.map((r) => ({ value: r.name, label: r.name, count: count({ regions: [r.name] }) }))}
                values={f.regions.filter((r) => g.regions.some((x) => x.name === r))}
                onChange={(vals) => {
                  const others = f.regions.filter((r) => !g.regions.some((x) => x.name === r))
                  patch({ regions: [...others, ...vals] })
                }}
              />
            ))}
          </div>
          <ChoiceGroup<'any' | TravelFilter>
            label="Travel from home"
            description="Drive times are curated estimates, not live routing. Fly-in destinations have no drive estimate."
            options={[
              { value: 'any', label: 'Any', count: count({ travel: null }) },
              ...TRAVELS.map((t) => ({ value: t, label: TRAVEL_LABEL[t], count: count({ travel: t }) })),
            ]}
            value={f.travel ?? 'any'}
            onChange={(v) => patch({ travel: v === 'any' ? null : v })}
          />
        </Section>

        <Section title={`Status & conditions · ${view.dateLabel}`}>
          <ToggleChips<StatusFilter>
            label="Operating status"
            description="As last reported. An announced opening date never counts as open; a confirmed closure on the day overrides “open”."
            options={STATUSES.map((s) => ({ value: s, label: STATUS_FILTER_LABEL[s], count: count({ status: [s] }) }))}
            values={f.status}
            onChange={(v) => patch({ status: v })}
          />
          <Checkbox
            label={`Hide resorts confirmed closed on ${view.dateLabel}`}
            hint={`${count({ hideClosed: true })} would remain`}
            checked={f.hideClosed}
            onChange={(e) => patch({ hideClosed: e.target.checked })}
          />
          <ChoiceGroup<string>
            label={`Conditions score (${view.modeLabel})`}
            description="Only complete scores count. Weather-potential and limited-data scores are treated as unknown; a confirmed closure fails."
            options={[
              { value: 'any', label: 'Any', count: count({ minScore: null }) },
              ...SCORE_OPTIONS.map((o) => ({ value: String(o.value), label: `${o.label} (${o.short})`, count: count({ minScore: o.value }) })),
            ]}
            value={f.minScore ? String(f.minScore) : 'any'}
            onChange={(v) => patch({ minScore: v === 'any' ? null : Number(v) })}
          />
        </Section>

        <Section title="Learning">
          <ChoiceGroup<'any' | 'good' | 'ok'>
            label="Learning suitability"
            hideLabel
            description="From lessons, beginner terrain share and a dedicated beginner area — not from your ability."
            options={[
              { value: 'any', label: 'Any', count: count({ learning: null }) },
              { value: 'good', label: 'Good for learning', count: count({ learning: 'good' }) },
              { value: 'ok', label: 'Learning possible or better', count: count({ learning: 'ok' }) },
            ]}
            value={f.learning ?? 'any'}
            onChange={(v) => patch({ learning: v === 'any' ? null : v })}
          />
        </Section>

        <Section title="Passes">
          <ToggleChips<string>
            label="Pass family"
            description={`Discovery only — affiliation never implies you own a pass. Unconfirmed ${view.seasonLabel} access counts as unknown.`}
            options={view.families.map((fam) => ({ value: fam.id, label: fam.name, count: count({ families: [fam.id] }) }))}
            values={f.families}
            onChange={(v) => patch({ families: v })}
          />
          <ProductPicker view={view} filters={f} onChange={patch} count={count} />
        </Section>

        <Section title="Day cost">
          <ChoiceGroup<string>
            label="Per-person day basket"
            hideLabel
            description="Lift access + your rental option + lunch + parking, same assumptions everywhere. Incomplete estimates are unknown."
            options={[
              { value: 'any', label: 'Any', count: count({ maxTier: null }) },
              ...EXPENSE_TIERS.map((tier, i) => ({
                value: String(i + 1),
                label: i === 0 ? tier : `≤ ${tier}`,
                text: i === 0 ? `${tier} only` : `${tier} or less`,
                count: count({ maxTier: i + 1 }),
              })),
            ]}
            value={f.maxTier ? String(f.maxTier) : 'any'}
            onChange={(v) => patch({ maxTier: v === 'any' ? null : Number(v) })}
          />
        </Section>

        <Section title="On the mountain">
          {FEATURES.map((k) => (
            <TriFilter key={k} feature={k} value={f[k]} onChange={(v) => patch({ [k]: v } as Partial<ExploreFilters>)} count={count} />
          ))}
        </Section>

        <Section title="More">
          <Checkbox
            label={`Events within 3 days of ${view.dateLabel}`}
            hint={`${count({ events: true })} resorts · only announced or tentative dates count`}
            checked={f.events}
            onChange={(e) => patch({ events: e.target.checked })}
          />
          <Checkbox
            label="Favourites only"
            hint={`${count({ favorites: true })} resorts`}
            checked={f.favorites}
            onChange={(e) => patch({ favorites: e.target.checked })}
          />
          <Checkbox
            label="Keep resorts with unknown values"
            hint="They stay in the list and the card says which values are unknown."
            checked={f.includeUnknown}
            onChange={(e) => patch({ includeUnknown: e.target.checked })}
          />
        </Section>
      </div>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h3 id={id} className="border-b border-divider pb-2 text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function TriFilter({
  feature,
  value,
  onChange,
  count,
}: {
  feature: FeatureKey
  value: TriState | null
  onChange: (v: TriState | null) => void
  count: (p: Partial<ExploreFilters>) => number
}) {
  const options: ChoiceOption<'any' | TriState>[] = [
    { value: 'any', label: 'Any', count: count({ [feature]: null }) },
    { value: 'yes', label: 'Offered', count: count({ [feature]: 'yes' }) },
    { value: 'no', label: 'Not offered', count: count({ [feature]: 'no' }) },
    { value: 'unknown', label: 'Unknown', hint: 'Not recorded in the catalog yet', count: count({ [feature]: 'unknown' }) },
  ]
  return <ChoiceGroup label={FEATURE_LABEL[feature]} options={options} value={value ?? 'any'} onChange={(v) => onChange(v === 'any' ? null : v)} />
}

function ProductPicker({
  view,
  filters: f,
  onChange,
  count,
}: {
  view: ExploreView
  filters: ExploreFilters
  onChange: (p: Partial<ExploreFilters>) => void
  count: (p: Partial<ExploreFilters>) => number
}) {
  const id = useId()
  const owned = view.products.filter((p) => p.owned)
  const byFamily = new Map<string, typeof view.products>()
  for (const p of view.products.filter((x) => !x.owned)) {
    const list = byFamily.get(p.familyName) ?? []
    list.push(p)
    byFamily.set(p.familyName, list)
  }
  const product = f.product ? view.products.find((p) => p.id === f.product) : null
  const canUsable = !!f.product || view.owned.length > 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
          Exact pass product
        </label>
        <Select id={id} value={f.product ?? ''} onChange={(e) => onChange({ product: e.target.value || null })}>
          <option value="">Any product</option>
          {owned.length ? (
            <optgroup label="Your passes">
              {owned.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.resortCount})
                </option>
              ))}
            </optgroup>
          ) : null}
          {[...byFamily.entries()].map(([fam, list]) => (
            <optgroup key={fam} label={fam}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.resortCount})
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <p className="text-[12.5px] text-ink-3">
          Checked against {view.seasonLabel} product rules for {view.dateLabel}: blackouts, day limits and reservations.{' '}
          <Link href="/passes" className="font-medium text-teal hover:underline">
            Pass checker
          </Link>
        </p>
      </div>
      <div className={cn(!canUsable && 'opacity-60')}>
        <Checkbox
          label={product ? `Only where ${product.name} can be used on ${view.dateLabel}` : `Only where your pass can be used on ${view.dateLabel}`}
          hint={
            canUsable
              ? `${count({ usable: true })} resorts · unconfirmed access counts as unknown`
              : 'Choose a product above, or record the pass you own in Passes & Costs.'
          }
          checked={f.usable}
          disabled={!canUsable}
          onChange={(e) => onChange({ usable: e.target.checked })}
        />
      </div>
    </div>
  )
}

/** Toolbar trigger: "Filters" with the active count. Forwards ref/props so it can be a Radix `asChild` trigger. */
export const FilterButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { count: number }>(function FilterButton(
  { count, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-[14px] font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-95 sm:px-3.5 lg:h-10',
        count ? 'border-transparent bg-ink-chip text-on-ink-chip' : 'border-[var(--glass-edge)] bg-glass-strong text-ink hover:border-teal hover:text-teal',
        className,
      )}
    >
      <SlidersHorizontal aria-hidden className="size-4" />
      <span className="max-sm:sr-only">Filters</span>
      {count ? (
        <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-on-ink-chip px-1.5 text-[12px] font-semibold text-ink-chip">
          <span className="sr-only">(</span>
          {count}
          <span className="sr-only"> active)</span>
        </span>
      ) : null}
    </button>
  )
})
