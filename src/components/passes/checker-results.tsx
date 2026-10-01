/**
 * The checker's answer, from the product's own rules:
 * - pass × resort → one verdict per day (logged days and earlier days of the range consume allotments), the rule on
 *   file with its versions, the shared day pool, product notes and a route to enter a confirmed rule;
 * - pass only → where it works on those dates; resort only → which products work there.
 * Unknown is always "Not confirmed — not permission", never green.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarCheck2, ExternalLink, History, Info, Layers, PenLine } from 'lucide-react'
import { PassBadge } from '@/components/ui/badge'
import { SourceDrawer, type SourceItem } from '@/components/ui/source-drawer'
import type { CheckDay, CheckerResult, CheckerView, PoolView, ProductAnswer, ResortAnswer, RuleVersionView } from '@/lib/data/passes-screen'
import type { AccessVerdict } from '@/lib/domain/passes/types'
import { cn } from '@/lib/ui/cn'
import { AccessMark } from './access-mark'
import { ACCESS_TYPE_LABEL, dayLabel, dayNumber, dotJoin, familyId, instantDate, plural, rangeLabel, STATUS_META, TONE_TEXT, weekdayShort } from './format'
import { checkerHref } from './params'
import { PunchMeter } from './punch-meter'
import { ConfirmTag, HolderTag, SubHead, YouEnteredTag } from './section'

const CONFIRM_RE = /^(Researched — confirm at source\.?|Rule source not verified — confirm on the official page\.?)$/

/**
 * Reasons worth showing beside a verdict. The "confirm at source" line becomes a tag, and the rule's own notes and
 * eligibility are left to the rule panel (they are the same for every day).
 */
function reasonsOf(v: AccessVerdict, rule: RuleVersionView | null, skipFirst = false): string[] {
  return v.reasons
    .slice(skipFirst ? 1 : 0)
    .filter((r) => !CONFIRM_RE.test(r) && r !== 'This date is in the past.' && r !== rule?.notes && !r.startsWith('Eligibility: '))
}

/** "2 included", "1 blacked out", "3 not confirmed". */
const COUNT_WORD: Record<AccessVerdict['status'], string> = {
  included: 'included',
  'included-limited': 'included',
  blackout: 'blacked out',
  'days-exhausted': 'no days left',
  'discount-only': 'discount only',
  'not-included': 'not included',
  unknown: 'not confirmed',
  'season-mismatch': 'other season',
}

function heroHeadline(v: AccessVerdict): string {
  if (v.status === 'unknown') return 'Not confirmed — not permission'
  return v.headline || STATUS_META[v.status].label
}

export function editHref(productId: string, resortId: string, back: { own?: number | null; from?: string | null } = {}): string {
  const q = new URLSearchParams()
  if (back.own != null) q.set('own', String(back.own))
  if (back.from) q.set('from', back.from)
  const s = q.toString()
  return `/passes/rules/${productId}/${resortId}${s ? `?${s}` : ''}`
}

function ruleSources(r: CheckerResult): SourceItem[] {
  const items: SourceItem[] = []
  if (r.rule) items.push({ label: `Access rule, version ${r.rule.version}: ${r.product.name} at ${r.resort.name}`, value: ACCESS_TYPE_LABEL[r.rule.access], prov: r.rule.prov })
  else items.push({ label: `Access rule: ${r.product.name} at ${r.resort.name}`, value: 'No rule recorded', prov: null })
  items.push({ label: `Product: ${r.product.name}`, value: r.product.summary ?? undefined, prov: r.product.prov })
  return items
}

// ---------------------------------------------------------------------------

export function CheckerResults({ view }: { view: CheckerView }) {
  if (view.mode === 'both' && view.result) return <DayByDay r={view.result} from={view.selection.from} to={view.selection.to} />
  if (view.mode === 'pass' && view.byResort) return <WhereItWorks view={view} answers={view.byResort} />
  if (view.mode === 'resort' && view.byProduct) return <WhatWorksHere view={view} answers={view.byProduct} />
  return null
}

// ---------------------------------------------------------------------------
// Pass × resort

function DayByDay({ r, from, to }: { r: CheckerResult; from: string; to: string }) {
  const single = r.days.length === 1
  const first = r.days[0]?.verdict
  const confirm = r.days.some((d) => d.verdict.confirmAtSource)
  const fam = familyId(r.product.familyId)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <PassBadge family={fam} size="sm" />
            <span className="text-[16px] font-semibold text-ink">{r.product.name}</span>
            {r.owned ? <HolderTag holder={r.owned.holder} /> : null}
          </p>
          <p className="mt-1 text-[14px] text-ink-2">
            at{' '}
            <Link href={`/resorts/${r.resort.id}`} className="font-medium text-ink hover:text-teal hover:underline">
              {r.resort.name}
            </Link>{' '}
            · {rangeLabel(from, to)}
            {r.owned ? ` · ${plural(r.owned.loggedDays, 'day')} logged this season` : ''}
          </p>
        </div>
        <SourceDrawer title="Rule and product sources" label="Sources" compact={false} items={ruleSources(r)} />
      </div>

      {single && first ? <SingleVerdict v={first} rule={r.rule} /> : <RangeVerdict r={r} />}

      {confirm ? (
        <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
          <ConfirmTag />
          <span>The rule behind this answer is research-grade or unverified — check the official page before you rely on it.</span>
        </p>
      ) : null}

      {!single ? <DayList r={r} /> : null}

      <RulePanel r={r} from={from} />
      {r.pool ? <PoolPanel pool={r.pool} resortId={r.resort.id} /> : null}
      <ProductNotes r={r} />

      <p className="flex items-start gap-2 border-t border-divider pt-3 text-[12.5px] text-ink-3">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Pass rules only — whether {r.resort.name} is open on {single ? 'that day' : 'those days'} is separate.{' '}
          <Link href={`/resorts/${r.resort.id}`} className="font-medium text-teal hover:underline">
            Opening and conditions
          </Link>
        </span>
      </p>
    </div>
  )
}

function verdictFrame(tone: string, unknown: boolean): string {
  if (unknown) return 'border-dashed border-divider-strong bg-surface-2'
  if (tone === 'positive') return 'border-positive/30 bg-positive-bg/50'
  if (tone === 'caution') return 'border-caution/30 bg-caution-bg/50'
  if (tone === 'critical') return 'border-critical/30 bg-critical-bg/40'
  return 'border-divider bg-surface-2'
}

function SingleVerdict({ v, rule }: { v: AccessVerdict; rule: RuleVersionView | null }) {
  const m = STATUS_META[v.status]
  const reasons = reasonsOf(v, rule)
  const unknown = v.status === 'unknown'
  const allowance = v.pool?.total ?? v.resortCap?.total ?? null
  return (
    <div className={cn('rounded-[12px] border px-4 py-4 md:px-5', verdictFrame(m.tone, unknown))}>
      <div className="flex items-start gap-3">
        <m.Icon aria-hidden className={cn('mt-1 size-7 shrink-0 md:size-8', TONE_TEXT[m.tone])} strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className={cn('font-display text-[28px] leading-[1.05] md:text-[32px]', unknown ? 'text-ink' : TONE_TEXT[m.tone])}>
            {heroHeadline(v)}
            <span className="sr-only"> ({m.label})</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
            <span>{dayLabel(v.date, true)}</span>
            {v.isPast ? <span className="rounded-sm bg-surface-3 px-1.5 text-[12px] text-ink-2">Past date</span> : null}
            {v.alreadyCounted === 'logged' ? <span className="rounded-sm bg-surface-3 px-1.5 text-[12px] text-ink-2">Already logged</span> : null}
            {v.remainingAfterVisit != null && v.canSki ? <span className="tnum">· {plural(v.remainingAfterVisit, 'day')} left after this one</span> : null}
          </p>
        </div>
      </div>
      {allowance != null && (v.status === 'included-limited' || v.status === 'days-exhausted') ? (
        <div className="mt-3 md:pl-11">
          <PunchMeter total={allowance} used={allowance - (v.remainingDays ?? 0)} label={v.pool ? (v.pool.label ?? 'Shared pool') : 'Days at this resort'} />
        </div>
      ) : null}
      {reasons.length ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-[14px] text-ink md:pl-11">
          {reasons.map((x, i) => (
            <li key={i} className={cn('flex gap-2', i > 0 && 'text-ink-2')}>
              <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function RangeVerdict({ r }: { r: CheckerResult }) {
  const n = r.days.length
  const counts = new Map<string, { status: AccessVerdict['status']; n: number }>()
  for (const d of r.days) {
    const word = COUNT_WORD[d.verdict.status]
    const cur = counts.get(word)
    counts.set(word, { status: cur?.status ?? d.verdict.status, n: (cur?.n ?? 0) + 1 })
  }
  const allUnknown = r.days.every((d) => d.verdict.status === 'unknown')
  return (
    <div className={cn('rounded-[12px] border px-4 py-4 md:px-5', allUnknown ? 'border-dashed border-divider-strong bg-surface-2' : 'border-divider bg-surface-2')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-[40px] leading-none text-ink tnum">
            {r.covered}
            <span className="text-ink-3">/{n}</span>
          </span>
          <span className="text-[14px] text-ink-2">{allUnknown ? 'days confirmed — access not confirmed' : 'days the pass can be used'}</span>
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Days by status">
          {[...counts]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([word, c]) => (
              <li key={word}>
                <AccessMark status={c.status} label={`${c.n} ${word}`} />
              </li>
            ))}
        </ul>
      </div>
      <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Day by day">
        {r.days.map((d) => {
          const m = STATUS_META[d.verdict.status]
          return (
            <li
              key={d.date}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-[10px] border bg-surface px-1 py-2 text-center',
                d.verdict.status === 'unknown' ? 'border-dashed border-divider-strong' : 'border-divider',
              )}
            >
              <span className="text-[12px] text-ink-3">{weekdayShort(d.date)}</span>
              <span className="text-[15px] font-semibold text-ink tnum">{dayNumber(d.date)}</span>
              <m.Icon aria-hidden className={cn('size-4', TONE_TEXT[m.tone])} strokeWidth={2} />
              <span className="sr-only">
                {dayLabel(d.date)}: {m.label}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-[12.5px] text-ink-3">Assumes you ski every day in the range: each covered day uses one pass day before the next is checked.</p>
    </div>
  )
}

function DayList({ r }: { r: CheckerResult }) {
  // Conditions that apply to every covered day (reservations, product blackout notes) are stated once.
  const firstCovered = r.days.find((d) => d.verdict.canSki)?.verdict
  const common = firstCovered ? reasonsOf(firstCovered, r.rule, true) : []
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
        {r.days.map((d) => {
          const v = d.verdict
          const own = reasonsOf(v, r.rule, true).filter((x) => !common.includes(x))
          return (
            <li key={d.date} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[112px_minmax(0,1fr)]">
              <p className="text-[14px] font-medium text-ink tnum">
                {dayLabel(d.date)}
                {v.isPast ? <span className="ml-1.5 text-[12px] font-normal text-ink-3">past</span> : null}
              </p>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <AccessMark status={v.status} variant="inline" label={v.status === 'unknown' ? 'Not confirmed' : v.headline || undefined} />
                  {v.canSki && v.remainingAfterVisit != null ? <span className="text-[12.5px] text-ink-3 tnum">{plural(v.remainingAfterVisit, 'day')} left after</span> : null}
                  {v.alreadyCounted === 'logged' ? <span className="text-[12.5px] text-ink-3">already logged</span> : null}
                </p>
                {!v.canSki && v.reasons[0] ? <p className="mt-0.5 text-[13px] text-ink-2">{v.reasons[0]}</p> : null}
                {own.map((x, i) => (
                  <p key={i} className="mt-0.5 text-[12.5px] text-ink-2">
                    {x}
                  </p>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      {common.length ? (
        <div className="rounded-[10px] bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
          <p className="mb-1 font-medium text-ink">On every covered day</p>
          <ul className="flex flex-col gap-1">
            {common.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[8px] size-1 shrink-0 rounded-full bg-ink-3" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function reservationText(v: boolean | null): string {
  return v === true ? 'Required' : v === false ? 'Not required' : 'Not recorded'
}

function RuleFacts({ rule, resortName }: { rule: RuleVersionView; resortName: string }) {
  const rows: [string, ReactNode][] = [['Access', ACCESS_TYPE_LABEL[rule.access]]]
  if (rule.access === 'limited-days') rows.push(['Days', rule.days != null ? `${plural(rule.days, 'day')} at ${resortName}` : 'Not recorded'])
  if (rule.poolId) rows.push(['Shared pool', dotJoin(rule.poolLabel ?? rule.poolId, rule.access === 'shared-pool' && rule.days != null ? plural(rule.days, 'day') : null)])
  if (rule.access !== 'not-included' && rule.access !== 'unknown') {
    rows.push([
      'Blackouts',
      rule.blackouts.length ? (
        <ul className="flex flex-col gap-0.5">
          {rule.blackouts.map((b, i) => (
            <li key={i} className="tnum">
              {b.from === b.to ? dayLabel(b.from, true) : `${dayLabel(b.from)} – ${dayLabel(b.to, true)}`}
              {b.label ? <span className="text-ink-3"> · {b.label}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        'None recorded'
      ),
    ])
    rows.push(['Reservations', reservationText(rule.reservationRequired)])
  }
  if (rule.access === 'discount-only') rows.push(['Discount', rule.discountText ?? 'Terms not recorded'])
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function RuleProvenance({ rule }: { rule: RuleVersionView }) {
  const when = instantDate(rule.youEntered ? rule.prov?.fetchedAt : rule.updatedAt)
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
      <span className="font-medium text-ink-2">Version {rule.version}</span>
      {rule.youEntered ? <YouEnteredTag /> : rule.confirmAtSource ? <ConfirmTag text={rule.verificationLabel} /> : <span>{rule.verificationLabel}</span>}
      {rule.prov?.provider && !rule.youEntered ? <span>{rule.prov.provider}</span> : null}
      {when ? (
        <span>
          · {rule.youEntered ? 'entered' : 'recorded'} {when}
        </span>
      ) : null}
    </p>
  )
}

function RulePanel({ r, from }: { r: CheckerResult; from: string }) {
  const rule = r.rule
  const unknown = !rule || rule.access === 'unknown'
  const notes = [rule?.reservationNotes ? `Reservations: ${rule.reservationNotes}` : null, rule?.eligibilityNotes ? `Eligibility: ${rule.eligibilityNotes}` : null, rule?.notes ?? null].filter(
    (x): x is string => !!x,
  )
  return (
    <section aria-labelledby="rule-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-4 md:p-5">
      <SubHead id="rule-title" aside={rule ? <RuleProvenance rule={rule} /> : null} className="flex-wrap">
        The rule behind this answer
      </SubHead>
      {rule ? (
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <RuleFacts rule={rule} resortName={r.resort.shortName} />
          {notes.length ? (
            <div className="flex flex-col gap-2 text-[13.5px] text-ink-2 md:border-l md:border-divider md:pl-6">
              {notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[14px] text-ink-2">
          No rule is recorded for {r.product.name} at {r.resort.name}. Access is <strong className="font-semibold text-ink">not confirmed</strong> — Piste never
          treats a missing rule as access.
        </p>
      )}
      {unknown ? (
        <p className="mt-3 rounded-[10px] border border-dashed border-divider-strong bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          Check the official page, then enter what it says. Your entry is saved as a new version with its source link — the researched record stays in the history.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={editHref(r.product.id, r.resort.id, { own: r.owned?.ownershipId ?? null, from })}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-md border px-3.5 text-[14px] font-medium transition-colors duration-150 max-md:h-11',
            unknown ? 'border-teal bg-teal text-on-teal hover:bg-teal-strong' : 'border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal',
          )}
        >
          <PenLine aria-hidden className="size-4" />
          {rule ? 'Enter a new version' : 'Enter the rule'}
        </Link>
        {r.product.links.slice(0, 3).map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-[13.5px] font-medium text-teal hover:underline max-md:h-11"
          >
            {l.label} <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ))}
      </div>
      {r.history.length > 1 ? (
        <details className="mt-4 border-t border-divider pt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-teal select-none hover:underline">
            <History aria-hidden className="size-3.5" /> All versions ({r.history.length}) — rules are never overwritten
          </summary>
          <ol className="mt-2 flex flex-col divide-y divide-divider text-[13px]">
            {r.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
                <span className="font-medium text-ink tnum">v{h.version}</span>
                <span className="text-ink">{ACCESS_TYPE_LABEL[h.access]}</span>
                {h.days != null ? <span className="text-ink-2 tnum">· {plural(h.days, 'day')}</span> : null}
                <span className="text-ink-3">· {h.verificationLabel}</span>
                {h.id === r.history[0].id ? <span className="rounded-sm bg-glacier px-1.5 text-[11.5px] font-semibold text-teal">current</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}

function PoolPanel({ pool, resortId }: { pool: PoolView; resortId: string }) {
  const names = pool.members.map((m) => m.name)
  const joined = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return (
    <section aria-labelledby="pool-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-4 md:p-5">
      <SubHead id="pool-title" aside={<Layers aria-hidden className="size-4 text-ink-3" />}>
        Shared day pool{pool.label ? `: ${pool.label}` : ''}
      </SubHead>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        <div>
          <p className="text-[14px] text-ink">
            {pool.total != null ? (
              <>
                <strong className="font-semibold tnum">{plural(pool.total, 'day')}</strong> shared between {joined}.
              </>
            ) : (
              <>Days shared between {joined} — the pool size is not recorded, so access is not confirmed.</>
            )}
          </p>
          {pool.total != null ? (
            <div className="mt-3">
              <PunchMeter total={pool.total} used={Math.min(pool.total, pool.used)} label="Before these dates" />
            </div>
          ) : null}
        </div>
        <ul className="flex flex-col gap-1 text-[13px]">
          {pool.members.map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3 border-b border-divider pb-1 last:border-b-0">
              <span className={cn('text-ink', m.id === resortId && 'font-semibold')}>{m.name}</span>
              <span className="text-ink-2 tnum">{m.used ? `${plural(m.used, 'day')} used` : 'not used yet'}</span>
            </li>
          ))}
        </ul>
      </div>
      {pool.conflictingTotals ? (
        <p className="mt-2 text-[12.5px] text-caution">Pool records disagree ({pool.conflictingTotals.join(' vs ')} days) — the smaller figure is used. Confirm at source.</p>
      ) : null}
      <p className="mt-3 text-[12.5px] text-ink-3">A day at any member resort uses a pool day; two resorts on the same date count as two days.</p>
    </section>
  )
}

function ProductNotes({ r }: { r: CheckerResult }) {
  const p = r.product
  if (!p.blackoutsSummary && !p.reservationsSummary && !p.summary) return null
  return (
    <details className="group rounded-[12px] border border-divider bg-surface-2 px-4 py-3 md:px-5">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-[14px] font-semibold text-ink select-none">
        <span>About {p.name} (all resorts)</span>
        <span className="text-[12.5px] font-medium text-teal group-open:hidden">Show</span>
        <span className="hidden text-[12.5px] font-medium text-teal group-open:inline">Hide</span>
      </summary>
      <dl className="mt-3 flex flex-col gap-2.5 text-[13.5px]">
        {p.blackoutsSummary ? (
          <div>
            <dt className="text-[12.5px] font-medium text-ink-3">Blackouts</dt>
            <dd className="text-ink">{p.blackoutsSummary}</dd>
          </div>
        ) : null}
        {p.reservationsSummary ? (
          <div>
            <dt className="text-[12.5px] font-medium text-ink-3">Reservations</dt>
            <dd className="text-ink">{p.reservationsSummary}</dd>
          </div>
        ) : null}
        {p.summary ? (
          <div>
            <dt className="text-[12.5px] font-medium text-ink-3">Summary</dt>
            <dd className="text-ink-2">{p.summary}</dd>
          </div>
        ) : null}
      </dl>
      {p.confirmAtSource ? <ConfirmTag className="mt-2" text={p.verificationLabel} /> : null}
    </details>
  )
}

// ---------------------------------------------------------------------------
// Pass only / resort only

function answerLabel(a: { days: CheckDay[]; covered: number }): { status: AccessVerdict['status']; label: string } {
  const n = a.days.length
  const first = a.days[0]?.verdict
  if (!first) return { status: 'unknown', label: 'Not confirmed' }
  if (n === 1) return { status: first.status, label: first.status === 'unknown' ? 'Not confirmed' : first.headline || STATUS_META[first.status].label }
  if (a.covered === n) return { status: first.status, label: `All ${n} days` }
  if (a.covered > 0) return { status: 'included-limited', label: `${a.covered} of ${n} days` }
  const worst = [...a.days].sort((x, y) => (x.verdict.status === 'unknown' ? -1 : 0) - (y.verdict.status === 'unknown' ? -1 : 0))[0].verdict
  return { status: worst.status, label: worst.status === 'unknown' ? 'Not confirmed' : STATUS_META[worst.status].label }
}

function group<T extends { days: CheckDay[]; covered: number }>(answers: T[]) {
  const can = answers.filter((a) => a.days.length && a.covered === a.days.length)
  const part = answers.filter((a) => a.covered > 0 && a.covered < a.days.length)
  const unknown = answers.filter((a) => a.covered === 0 && a.days.some((d) => d.verdict.status === 'unknown'))
  const cannot = answers.filter((a) => a.covered === 0 && !a.days.some((d) => d.verdict.status === 'unknown'))
  return [
    { id: 'can', title: 'Can use', items: can },
    { id: 'part', title: 'Some of the days', items: part },
    { id: 'unknown', title: 'Not confirmed — check before you go', items: unknown },
    { id: 'cannot', title: 'Can’t use', items: cannot },
  ].filter((g) => g.items.length)
}

function WhereItWorks({ view, answers }: { view: CheckerView; answers: ResortAnswer[] }) {
  const opt = view.passes.find((p) => p.key === view.selection.key)!
  const { from, to } = view.selection
  const groups = group(answers)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <PassBadge family={familyId(opt.familyId)} size="sm" />
          <span className="text-[16px] font-semibold text-ink">Where {opt.name} works</span>
          {opt.holder ? <HolderTag holder={opt.holder} /> : null}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {rangeLabel(from, to)} · every resort with a recorded rule, each checked on its own. Choose one for the day-by-day answer.
        </p>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.id} aria-label={g.title}>
            <h3 className="eyebrow mb-2">{g.title}</h3>
            <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
              {g.items.map((a) => {
                const l = answerLabel(a)
                return (
                  <li key={a.resort.id}>
                    <Link
                      href={checkerHref({ pass: view.selection.key, resort: a.resort.id, from, to })}
                      scroll={false}
                      className="group flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-medium text-ink group-hover:text-teal">{a.resort.name}</span>
                        <span className="block text-[12.5px] text-ink-3">
                          {dotJoin(
                            a.resort.region,
                            a.rule ? ACCESS_TYPE_LABEL[a.rule.access] : null,
                            a.covered && a.rule?.reservationRequired === true ? 'Reservation required' : null,
                            a.rule?.youEntered ? 'Manual — you entered' : a.rule?.confirmAtSource ? 'Researched' : null,
                          )}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <AccessMark status={l.status} label={l.label} className="max-sm:hidden" />
                        <AccessMark status={l.status} label={l.label} variant="cell" className="sm:hidden" />
                        <ArrowRight aria-hidden className="size-4 text-ink-3 group-hover:text-teal" />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[14px] text-ink-2">
          No resort rules are recorded for {opt.name} yet — nowhere is confirmed. Choose a resort to enter the rule from the official page.
        </p>
      )}
      <p className="text-[12.5px] text-ink-3">Resorts not listed have no rule for this pass: not confirmed, never assumed included.</p>
    </div>
  )
}

function WhatWorksHere({ view, answers }: { view: CheckerView; answers: ProductAnswer[] }) {
  const resort = view.resorts.find((r) => r.id === view.selection.resortId)!
  const { from, to } = view.selection
  const groups = group(answers)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          <CalendarCheck2 aria-hidden className="size-4 text-ink-3" />
          Passes at {resort.name}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {rangeLabel(from, to)} · your passes first, then every product with a recorded rule here. Choose one for the day-by-day answer.
        </p>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.id} aria-label={g.title}>
            <h3 className="eyebrow mb-2">{g.title}</h3>
            <ul className="flex flex-col divide-y divide-divider rounded-[12px] border border-divider bg-surface">
              {g.items.map((a) => {
                const l = answerLabel(a)
                return (
                  <li key={a.option.key}>
                    <Link
                      href={checkerHref({ pass: a.option.key, resort: resort.id, from, to })}
                      scroll={false}
                      className="group flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <PassBadge family={familyId(a.option.familyId)} size="sm" />
                        <span className="text-[14.5px] font-medium text-ink group-hover:text-teal">{a.option.name}</span>
                        {a.option.holder ? <HolderTag holder={a.option.holder} /> : null}
                        {!a.rule ? <span className="text-[12.5px] text-ink-3">no rule here</span> : null}
                        {a.covered && a.rule?.reservationRequired === true ? <span className="text-[12.5px] font-medium text-caution">Reservation required</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <AccessMark status={l.status} label={l.label} className="max-sm:hidden" />
                        <AccessMark status={l.status} label={l.label} variant="cell" className="sm:hidden" />
                        <ArrowRight aria-hidden className="size-4 text-ink-3 group-hover:text-teal" />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className="rounded-[12px] border border-dashed border-divider-strong bg-surface-2 p-4 text-[14px] text-ink-2">
          No pass product is recorded for {resort.name} in {view.season.label}. Lift tickets are the only known option — see{' '}
          <Link href="/passes/costs" className="font-medium text-teal hover:underline">
            day costs
          </Link>
          .
        </p>
      )}
    </div>
  )
}
