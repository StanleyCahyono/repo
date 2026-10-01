'use client'
/**
 * <ResortCard/> — the shared resort summary card (Explore list + map preview, Today watchlist, anywhere a resort is
 * summarised).
 *
 * Data: build `resort` on the server with `toResortCardData(summary, { units, now, seasonLabel })` from
 * './card-data' — a small, serializable, pre-formatted view model (never pass a whole ResortSummary to the client).
 *
 * Shows, in order of decision value: name/place, operating status + opening information, conditions score (or its
 * designed missing / limited / closed state), snow (reported vs weather-model, labelled in text), day cost tier (or
 * "Incomplete estimate"), travel (drive estimate vs fly-in with the practical airport), pass-family badges
 * (unconfirmed ones dashed + "2026–27 unconfirmed"), the owned-pass answer for the date, favourite + compare
 * toggles. When there is neither a score nor any snow information, the two collapse into one honest
 * "Not reported yet" cell instead of repeating two empty ones. Secondary facts (fit reasons, features tri-state,
 * learning suitability, events, data gaps with the catalog research level, sources) sit behind the Details expander.
 *
 * Interaction: hover/focus 150ms border change and a 1px lift ('card'), or a left accent ('row'); `highlighted`
 * mirrors a hovered map marker; `selected` glides a teal accent between cards (shared layoutId). Optional
 * `onHighlight` / `onLocate` wire a card to a map (Explore). All interactive children are real buttons/links.
 *
 * @example Today watchlist (server component parent — only serializable props):
 *   <ResortCard resort={toResortCardData(item.summary, { units: prefs.units, now, seasonLabel })} headingLevel={3} />
 */
import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, CalendarDays, ChevronDown, CircleAlert, CircleCheck, CircleHelp, CircleSlash, MapPin, Siren, Ticket, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/button'
import { FavoriteButton } from '@/components/ui/favorite-button'
import { KindTag, Missing } from '@/components/ui/provenance'
import { ScoreChip } from '@/components/ui/score'
import { SourceDrawer } from '@/components/ui/source-drawer'
import { OpeningTag, StatusPill } from '@/components/ui/status'
import { CompareToggle } from './card-compare'
import { RESEARCH_LABEL, type CardPassLine, type ResortCardData } from './card-data'
import { CardMedia } from './card-media'
import { CardPassBadges } from './card-passes'

export interface ResortCardProps {
  /** Pre-formatted view model from `toResortCardData()` (server side). */
  resort: ResortCardData
  /** 'card' (default): standalone bordered surface. 'row': entry inside a ruled list panel (Explore). */
  variant?: 'card' | 'row'
  /**
   * 'regular' (default). 'compact': no thumbnail, tighter facts, and an "Open" link to the resort page instead of the
   * Details expander — for map previews and dense watchlists.
   */
  density?: 'regular' | 'compact'
  /** Show the compare toggle (shared compare tray selection). Default true. */
  showCompare?: boolean
  /** Visual counterpart of a hovered map marker (no layout change). */
  highlighted?: boolean
  /** Explicitly selected (e.g. from its map marker): teal accent that glides between cards. */
  selected?: boolean
  /** Reports hover/focus enter (id) and leave (null) — Explore highlights the matching marker. Client parents only. */
  onHighlight?: (id: string | null) => void
  /** "Show on map" — explicit selection (the map flies to the resort). The button only renders when provided. */
  onLocate?: (id: string) => void
  /** Replaces the owned-pass line, e.g. the verdict for a product chosen in Explore's filters. */
  passLine?: CardPassLine | null
  /** Caution lines under the header, e.g. which filtered values are unknown for this resort. */
  notes?: string[]
  /** Start with Details open. */
  defaultExpanded?: boolean
  /** Heading level of the resort name (default 3). */
  headingLevel?: 2 | 3 | 4
  className?: string
}

const PASS_TONE: Record<CardPassLine['status'], string> = {
  covered: 'text-positive',
  'not-covered': 'text-ink-2',
  unconfirmed: 'text-caution',
}

export function ResortCard({
  resort: r,
  variant = 'card',
  density = 'regular',
  showCompare = true,
  highlighted = false,
  selected = false,
  onHighlight,
  onLocate,
  passLine,
  notes,
  defaultExpanded = false,
  headingLevel = 3,
  className,
}: ResortCardProps) {
  const [open, setOpen] = useState(defaultExpanded)
  const uid = useId()
  const titleId = `${uid}-title`
  const detailsId = `${uid}-details`
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const Sub = `h${Math.min(headingLevel + 1, 6)}` as 'h3' | 'h4' | 'h5'
  const pass = passLine === undefined ? r.pass : passLine
  const gapCount = r.gaps.length
  const row = variant === 'row'
  const compact = density === 'compact'

  // Exactly one border/accent treatment per state (cn() does not merge competing Tailwind classes).
  const surface = row
    ? 'bg-surface'
    : cn(
        'rounded-[12px] border bg-surface hover:-translate-y-px',
        selected ? 'border-teal' : highlighted ? 'border-teal/60' : 'border-divider hover:border-divider-strong focus-within:border-divider-strong',
      )

  return (
    <article
      aria-labelledby={titleId}
      data-resort-id={r.id}
      onMouseEnter={onHighlight ? () => onHighlight(r.id) : undefined}
      onMouseLeave={onHighlight ? () => onHighlight(null) : undefined}
      onFocus={onHighlight ? () => onHighlight(r.id) : undefined}
      onBlur={
        onHighlight
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight(null)
            }
          : undefined
      }
      className={cn('group/card @container relative transition-[border-color,transform] duration-150 ease-[var(--ease-out-soft)]', surface, className)}
    >
      {/* Left accent: selection (glides between cards), highlight from the map, or hover (rows). */}
      {selected ? (
        <motion.span
          layoutId="resort-card-selection"
          transition={t.select}
          aria-hidden
          className={cn('absolute left-0 z-[1] w-[3px] rounded-r-full bg-teal', row ? 'inset-y-3' : 'inset-y-4')}
        />
      ) : row ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-3 left-0 z-[1] w-[3px] rounded-r-full transition-opacity duration-150',
            highlighted ? 'bg-teal/60 opacity-100' : 'bg-divider-strong opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100',
          )}
        />
      ) : null}

      {/* Header */}
      <div className={cn('flex gap-3 px-4 @min-[460px]:gap-4', compact ? 'pt-3' : 'pt-4')}>
        {compact ? null : <CardMedia id={r.id} name={r.name} media={r.media} className="size-14 shrink-0 @min-[460px]:h-[76px] @min-[460px]:w-[92px]" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <H id={titleId} className="text-[17px] leading-snug font-semibold text-ink">
                <Link href={r.href} className="rounded-sm decoration-teal/60 underline-offset-[3px] hover:text-teal hover:underline">
                  {r.name}
                </Link>
              </H>
              <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-2">
                {r.place}
                <span aria-hidden className="text-ink-3">
                  {' '}
                  ·{' '}
                </span>
                <span className="sr-only">, </span>
                {r.region}
              </p>
            </div>
            <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">
              {onLocate ? (
                <IconButton label={`Show ${r.shortName} on the map`} size="lg" onClick={() => onLocate(r.id)} className="text-ink-2">
                  <MapPin aria-hidden className="size-[18px]" />
                </IconButton>
              ) : null}
              <FavoriteButton resortId={r.id} name={r.name} initial={r.isFavorite} size="lg" />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <span className="sr-only">Operating status{r.isToday || r.status.status === 'unknown' ? '' : ' now'}:</span>
              <StatusPill status={r.status.status} size="sm" />
              {/* The pill is the latest status; on another day say so (a closure on that day has its own banner). */}
              {!r.isToday && r.status.status !== 'unknown' ? (
                <span aria-hidden className="text-[12px] text-ink-3">
                  now
                </span>
              ) : null}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
              <span className="sr-only">Opening:</span>
              <OpeningTag label={r.opening.label} />
              {r.opening.dates ? <span className="tnum truncate">{r.opening.dates}</span> : null}
            </span>
            {r.demo ? (
              <Badge tone="demo" className="h-5 px-1.5">
                Demo
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {r.closure ? (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] bg-critical-bg px-3 py-2 text-[13px] text-ink">
          <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
          <span>
            <strong className="font-semibold">Closed on {r.dateLabel}.</strong> {r.closure.reason}
          </span>
        </p>
      ) : null}
      {r.alerts.count ? (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] bg-caution-bg px-3 py-2 text-[13px] text-ink">
          <Siren aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
          <span>
            <strong className="font-semibold">Official alert{r.alerts.count > 1 ? `s (${r.alerts.count})` : ''}:</strong> {r.alerts.headline}
          </span>
        </p>
      ) : null}
      {notes?.length ? (
        <p className="mx-4 mt-3 flex items-start gap-2 text-[12.5px] font-medium text-caution">
          <CircleHelp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{notes.join(' · ')}</span>
        </p>
      ) : null}

      <CardFacts r={r} compact={compact} />

      {/* Passes, research hint, actions (stacked in narrow containers so nothing overlaps). */}
      <div className="flex flex-col gap-2 px-4 py-2.5 @min-[520px]:flex-row @min-[520px]:items-center @min-[520px]:gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          {r.passes.length ? (
            <CardPassBadges passes={r.passes} seasonLabel={r.seasonLabel} />
          ) : (
            <span className="text-[12.5px] text-ink-3 italic">No pass family recorded</span>
          )}
          {pass ? (
            <span className={cn('inline-flex min-w-0 items-center gap-1 text-[12.5px] font-medium', PASS_TONE[pass.status])}>
              <Ticket aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                <span className="sr-only">Your pass: </span>
                {pass.productName}: {pass.headline}
              </span>
            </span>
          ) : null}
          {r.research || gapCount ? (
            <span
              className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-[12px] text-ink-3"
              title={r.research ? RESEARCH_LABEL[r.research].long : undefined}
            >
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              {r.research ? <span className="font-medium text-caution">{RESEARCH_LABEL[r.research].short}</span> : null}
              {r.research && gapCount ? <span aria-hidden>·</span> : null}
              {gapCount ? (
                <span className="tnum">
                  {gapCount} data gap{gapCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {showCompare ? <CompareToggle id={r.id} name={r.shortName} /> : null}
          {compact ? (
            <Link
              href={r.href}
              className="inline-flex h-11 items-center gap-1 rounded-md border border-teal bg-teal px-3 text-[13.5px] font-medium text-on-teal transition-colors duration-150 hover:border-teal-strong hover:bg-teal-strong md:h-9"
            >
              Open<span className="sr-only"> {r.name}</span>
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          ) : null}
          {compact ? null : (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? detailsId : undefined}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink md:h-9"
            >
              Details
              <span className="sr-only"> for {r.name}</span>
              <ChevronDown aria-hidden className={cn('size-4 transition-transform duration-150', open && 'rotate-180')} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && !compact ? (
          <motion.div
            key="details"
            id={detailsId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: t.select }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="border-t border-divider px-4 pt-4 pb-4"
          >
            <CardDetails r={r} pass={pass} Sub={Sub} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  )
}

/** The decision facts. Score + snow collapse into one cell when neither exists (preseason, no data). */
function CardFacts({ r, compact }: { r: ResortCardData; compact: boolean }) {
  const noScore = r.score.kind === 'none'
  const noSnow = !r.snow.reported && !r.snow.modeled
  const merged = noScore && noSnow
  const snowReason = r.snow.missing?.replace(/^No report on file · /, '') ?? null

  return (
    <dl
      className={cn(
        'mt-3 grid gap-px border-y border-divider bg-divider [--fact-num:24px]',
        compact && '[--fact-num:20px] [&>div]:py-2',
        merged ? 'grid-cols-2 @min-[540px]:grid-cols-3' : 'grid-cols-2 @min-[540px]:grid-cols-4',
      )}
    >
      {merged ? (
        <FactCell label="Conditions & snow" className="col-span-2 @min-[540px]:col-span-1">
          <span className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-3 italic">
            <CircleHelp aria-hidden className="size-4 shrink-0 not-italic" />
            No score or report yet
          </span>
          <FactCaption>{[r.score.caption, snowReason].filter(Boolean).join(' · ')}</FactCaption>
        </FactCell>
      ) : (
        <>
          <FactCell label="Conditions">
            <ScoreChip scoreKind={r.score.kind} score={r.score.value} coverage={r.score.coverage} size="sm" />
            <FactCaption>
              {r.score.kind === 'closed' ? 'No ski-day score' : r.score.kind === 'none' ? r.score.caption : `${r.score.modeLabel} · ${r.score.caption}`}
            </FactCaption>
          </FactCell>
          <FactCell label="Snow">
            <SnowFact r={r} />
          </FactCell>
        </>
      )}

      <FactCell label="Day cost">
        {r.expense.tier === 'incomplete' ? (
          <>
            <span className="text-[14px] leading-snug font-medium text-ink-2">Incomplete estimate</span>
            <FactCaption>{r.expense.caption}</FactCaption>
          </>
        ) : (
          <>
            <span className="flex items-baseline gap-2">
              <span className="font-display tnum text-[length:var(--fact-num)] leading-none text-copper">{r.expense.label}</span>
              {r.expense.amount ? <span className="tnum text-[14px] font-medium text-ink">≈ {r.expense.amount}</span> : null}
            </span>
            <FactCaption tone={r.expense.confirmAtSource ? 'caution' : undefined}>{r.expense.caption}</FactCaption>
          </>
        )}
      </FactCell>

      <FactCell label="Travel">
        {r.travel.mode === 'none' ? (
          <>
            <Missing label="Unknown" />
            <FactCaption>{r.travel.caption}</FactCaption>
          </>
        ) : (
          <>
            <span className="font-display tnum text-[length:var(--fact-num)] leading-none text-ink">{r.travel.headline}</span>
            <FactCaption>{r.travel.caption}</FactCaption>
          </>
        )}
      </FactCell>
    </dl>
  )
}

function SnowFact({ r }: { r: ResortCardData }) {
  const rep = r.snow.reported
  const mod = r.snow.modeled
  const modelLine = mod ? `Model, next 72 h: ${mod.headline.charAt(0).toLowerCase()}${mod.headline.slice(1)}` : null
  if (rep) {
    // The evidence tag says who reported it, so the age drops its "Reported" prefix.
    const age = rep.age?.replace(/^Reported /, '') ?? null
    return (
      <>
        <span className="tnum text-[15px] leading-snug font-semibold text-ink">{rep.headline}</span>
        <p className={cn('text-[12px] leading-snug', rep.stale ? 'text-caution' : 'text-ink-3')}>
          <KindTag kind={rep.kind} className="mr-1 align-[-2px]" />
          {[rep.detail, age, rep.stale ? 'stale' : null].filter(Boolean).join(' · ')}
        </p>
        {modelLine ? <FactCaption>{modelLine}</FactCaption> : null}
      </>
    )
  }
  if (mod) {
    return (
      <>
        <span className="tnum text-[15px] leading-snug font-semibold text-ink">{mod.headline}</span>
        <p className="text-[12px] leading-snug text-ink-3">
          <KindTag kind="modeled" className="mr-1 align-[-2px]" />
          {mod.detail?.replace(/ · model(?=$|,)/, '')}
        </p>
        <FactCaption>No snow report on file</FactCaption>
      </>
    )
  }
  return (
    <>
      <Missing label="No report" />
      <FactCaption>{r.snow.missing?.replace(/^No report on file · /, '') ?? null}</FactCaption>
    </>
  )
}

function FactCell({ label, sub, children, className }: { label: string; sub?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 bg-surface px-4 py-2.5', className)}>
      <dt className="flex min-w-0 items-baseline gap-1.5 text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        <span className="shrink-0">{label}</span>
        {sub ? <span className="truncate font-medium tracking-normal normal-case">· {sub}</span> : null}
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5">{children}</dd>
    </div>
  )
}

function FactCaption({ children, tone }: { children: ReactNode; tone?: 'caution' }) {
  if (!children) return null
  return <span className={cn('line-clamp-2 text-[12px] leading-snug', tone === 'caution' ? 'text-caution' : 'text-ink-3')}>{children}</span>
}

function TriState({ value }: { value: boolean | null }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-positive">
        <CircleCheck aria-hidden className="size-3.5" /> Offered
      </span>
    )
  if (value === false)
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-ink-2">
        <CircleSlash aria-hidden className="size-3.5" /> Not offered
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-ink-3 italic">
      <CircleHelp aria-hidden className="size-3.5 not-italic" /> Unknown
    </span>
  )
}

function TerrainBar({ terrain }: { terrain: NonNullable<ResortCardData['terrain']> }) {
  const parts = [
    { key: 'Beginner', pct: terrain.beginnerPct, cls: 'bg-positive', mark: '●' },
    { key: 'Intermediate', pct: terrain.intermediatePct, cls: 'bg-info', mark: '■' },
    { key: 'Advanced', pct: terrain.advancedPct, cls: 'bg-ink', mark: '◆' },
  ]
  const known = parts.filter((p) => p.pct !== null)
  return (
    <div className="mt-2">
      <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
        {known.map((p) => (
          <span key={p.key} className={cn('h-full', p.cls)} style={{ width: `${p.pct}%` }} />
        ))}
      </div>
      <p className="tnum mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-2">
        {parts.map((p) => (
          <span key={p.key}>
            <span aria-hidden>{p.mark} </span>
            {p.key} {p.pct === null ? <em className="text-ink-3">unknown</em> : `${p.pct}%`}
          </span>
        ))}
      </p>
    </div>
  )
}

function CardDetails({ r, pass, Sub }: { r: ResortCardData; pass: CardPassLine | null; Sub: 'h3' | 'h4' | 'h5' }) {
  const head = 'mb-1.5 text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase'
  return (
    <div className="grid gap-x-6 gap-y-5 @min-[540px]:grid-cols-2">
      <section>
        <Sub className={head}>Fit for you</Sub>
        <p className="text-[14px] text-ink">
          <span className="font-semibold">{r.fit.label}</span>
          {r.fit.score !== null ? <span className="tnum text-ink-2"> · {r.fit.score}/100</span> : null}
          <span className="text-[12.5px] text-ink-3"> · {r.fit.confidence} confidence</span>
        </p>
        {r.fit.reasons.length ? (
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-ink-2 marker:text-ink-3">
            {r.fit.reasons.slice(0, 3).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        {r.fit.unknowns.length ? <p className="mt-1 text-[12.5px] text-ink-3">Not counted: {r.fit.unknowns.join('; ')}</p> : null}
        <p className="mt-1 text-[12px] text-ink-3">Fit is personal and separate from the day&apos;s conditions score.</p>
      </section>

      <section>
        <Sub className={head}>On the mountain</Sub>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1">
          {r.features.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-[13px] text-ink-2">{f.label}</dt>
              <dd>
                <TriState value={f.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <Sub className={head}>Learning</Sub>
        <p className="text-[14px] font-semibold text-ink">{r.learning.label}</p>
        <p className="text-[13px] text-ink-2">
          {r.learning.reason}
          {r.learning.researched && r.terrain ? <span className="text-ink-3"> · researched split, confirm at source</span> : null}
        </p>
        {r.terrain ? <TerrainBar terrain={r.terrain} /> : null}
      </section>

      <section>
        <Sub className={head}>Season &amp; status</Sub>
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">
          <OpeningTag label={r.opening.label} />
          <span className="tnum">{r.opening.text}</span>
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {r.status.label}
          {r.status.asOf ? ` · ${r.status.asOf}` : ''}
          {r.status.note ? ` — ${r.status.note}` : ''}
        </p>
        {r.status.status === 'unknown' ? <p className="mt-1 text-[12.5px] text-caution">Unknown status is never treated as open.</p> : null}
      </section>

      <section>
        <Sub className={head}>Passes on {r.dateLabel}</Sub>
        {pass ? (
          <p className={cn('text-[13.5px] font-medium', PASS_TONE[pass.status])}>
            {pass.productName}: {pass.headline}
            {pass.confirmAtSource ? <span className="font-normal text-caution"> · confirm at source</span> : null}
          </p>
        ) : (
          <p className="text-[13.5px] text-ink-2">
            No pass recorded.{' '}
            <Link href="/passes" className="font-medium text-teal hover:underline">
              Check exact access in Passes &amp; Costs
            </Link>
          </p>
        )}
        {r.passes.length ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
            {r.passes.map((p) => (
              <li key={p.familyId}>{p.title}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-[12px] text-ink-3">Family badges are for discovery — affiliation never implies you own a pass.</p>
      </section>

      <section>
        <Sub className={head}>Events</Sub>
        {r.events.next ? (
          <p className="flex items-start gap-1.5 text-[13.5px] text-ink">
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span>
              <span className="font-medium">{r.events.next.title}</span>
              <span className="text-ink-2">
                {' '}
                · {r.events.next.when} · {r.events.next.statusLabel}
              </span>
              {r.events.count > 1 ? <span className="text-ink-3"> · +{r.events.count - 1} more</span> : null}
            </span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-2">No dated events {r.events.windowLabel}.</p>
        )}
        <Link
          href={`/explore/events?resort=${encodeURIComponent(r.id)}&when=season`}
          className="mt-1 inline-flex text-[12.5px] font-medium text-teal hover:underline"
        >
          Events at {r.shortName}
        </Link>
      </section>

      <section className="@min-[540px]:col-span-2">
        <Sub className={head}>Data gaps</Sub>
        {r.research ? (
          <p className="mb-1.5 flex items-start gap-1.5 text-[13px] text-caution">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="font-semibold">{RESEARCH_LABEL[r.research].short}.</strong> {RESEARCH_LABEL[r.research].long}.
            </span>
          </p>
        ) : null}
        {r.gaps.length ? (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-ink-2 marker:text-ink-3">
            {r.gaps.slice(0, 6).map((g) => (
              <li key={g}>{g}</li>
            ))}
            {r.gaps.length > 6 ? <li className="text-ink-3">+{r.gaps.length - 6} more on the resort page</li> : null}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-2">No known gaps for this date.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-3 @min-[540px]:col-span-2">
        <SourceDrawer title={`${r.name} — sources`} items={r.sources} label="Sources for these facts" compact={false} className="text-[13px]" />
        <Link href={r.href} className="inline-flex h-11 items-center gap-1 rounded-md px-1 text-[13.5px] font-medium text-teal hover:underline md:h-8">
          Open resort page <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  )
}
