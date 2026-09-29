/**
 * 03 Plan a visit — published hours by activity (with season, timezone and "published hours ≠ every lift
 * running"), exact pass access for the planning date (my products first; unknown rules say so and are never
 * permission), price snapshots with season / quote kind / source, the per-person day basket with its expense tier
 * or "Incomplete estimate", and lessons, rentals, parking and road/transit links.
 */
import Link from 'next/link'
import { ArrowRight, BadgeCheck, CalendarX2, CircleHelp, Clock3, ExternalLink, GraduationCap, KeyRound, ParkingSquare, Ticket, TrafficCone, XCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { PassBadge } from '@/components/ui/badge'
import { Disclosure } from '@/components/ui/disclosure'
import { KindTag, Missing } from '@/components/ui/provenance'
import type { PassAccessRow, PriceView, ResortDetail } from '@/lib/data/resort-detail'
import { describeBands, LINE_KIND_LABEL, RENTAL_LABEL } from '@/lib/domain/costs'
import { formatMoney, formatMoneyRange } from '@/lib/domain/money'
import { ACCESS_STATUS_LABEL } from '@/lib/domain/passes'
import { PASS_FAMILIES, type PassFamilyId } from '@/lib/domain/types'
import { ConfirmTag, ResortSection, Src, SubHead, TriChip } from './section'
import { accessTone, ACTIVITY_LABEL, clock, confirmText, CORE_ACTIVITIES, dayLabel, dayLabelYear, dotJoin, hostOf, plural, seasonText, shortDate, src, TRANSFER_TYPE_LABEL, weekdaysText, type PageView } from './format'

const DAY_TYPE_TEXT: Record<string, string> = { weekday: 'weekday', weekend: 'weekend', holiday: 'holiday' }

export function PlanSection({ d, v }: { d: ResortDetail; v: PageView }) {
  const dayType = d.basket.holidayName ? `${d.basket.holidayName} (holiday)` : DAY_TYPE_TEXT[d.basket.dayType] ?? d.basket.dayType
  return (
    <ResortSection id="plan" index={3} title="Plan a visit" meta={`${dayLabelYear(v.date)} · ${dayType}`}>
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <HoursBlock d={d} v={v} />
          <AccessBlock d={d} v={v} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <BasketBlock d={d} v={v} />
          <PricesBlock d={d} v={v} />
        </div>
        <Practical d={d} />
      </div>
    </ResortSection>
  )
}

// ---------------------------------------------------------------------------
// Hours

function HoursBlock({ d, v }: { d: ResortDetail; v: PageView }) {
  const h = d.hours
  const recorded = new Set(h.schedules.map((s) => s.activity))
  const activities = [...CORE_ACTIVITIES, ...[...recorded].filter((a) => !(CORE_ACTIVITIES as readonly string[]).includes(a))]
  const hourProvs = h.schedules.filter((s) => s.prov).map((s) => src(`${ACTIVITY_LABEL[s.activity] ?? s.activity}: ${s.label}`, s.prov))
  return (
    <section aria-labelledby="hours-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-5">
      <SubHead id="hours-title" aside={hourProvs.length ? <Src title="Hours" items={hourProvs} /> : null}>
        Hours on {dayLabel(v.date)}
      </SubHead>
      <p className="-mt-2 mb-3 flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Clock3 aria-hidden className="size-3.5" /> Resort time · {h.timezone.replace(/_/g, ' ')} ({h.zoneAbbrev})
      </p>
      <ul className="flex flex-col divide-y divide-divider">
        {activities.map((a) => {
          const today = h.forDate.filter((f) => f.activity === a)
          const onFile = h.schedules.filter((s) => s.activity === a)
          return (
            <li key={a} className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 py-2.5">
              <span className="text-[13.5px] text-ink-2">{ACTIVITY_LABEL[a] ?? a}</span>
              <span className="min-w-0">
                {today.length ? (
                  today.map((f, i) => (
                    <span key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[14.5px] font-medium text-ink tnum">
                        {f.closed ? 'Closed' : f.opens || f.closes ? `${clock(f.opens) ?? '?'}–${clock(f.closes) ?? 'close not stated'}` : 'Times not stated'}
                      </span>
                      <span className="text-[12.5px] text-ink-3">
                        {dotJoin(f.label, f.nature === 'live' ? 'live statement' : 'published', f.source === 'exception' ? 'special hours for this date' : null)}
                      </span>
                    </span>
                  ))
                ) : onFile.length ? (
                  <span className="text-[13.5px] text-ink-3 italic">
                    No hours for this date{onFile.every((s) => s.otherSeason) ? ` — only ${seasonText(onFile[0].seasonId)} hours on file` : ''}
                  </span>
                ) : (
                  <Missing label="Not recorded" />
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <ul className="mt-3 flex flex-col gap-0.5 border-t border-divider pt-3 text-[12.5px] text-ink-2">
        {h.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {h.schedules.length ? (
        <Disclosure summary={`All schedules on file (${h.schedules.length})`} className="mt-3 border-t border-divider pt-2">
          <div className="relative -mx-1 mt-2 overflow-x-auto px-1">
            <table className="w-full min-w-[440px] text-left text-[12.5px]">
              <caption className="sr-only">Every operating schedule on file</caption>
              <thead>
                <tr className="border-b border-divider text-ink-3">
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Activity
                  </th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">
                    Times
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    Season
                  </th>
                </tr>
              </thead>
              <tbody>
                {h.schedules.map((s) => (
                  <tr key={s.id} className="border-b border-divider align-top last:border-b-0">
                    <td className="py-1.5 pr-2 text-ink">{ACTIVITY_LABEL[s.activity] ?? s.activity}</td>
                    <td className="py-1.5 pr-2 text-ink-2">
                      {s.label}
                      <span className="block text-ink-3">{s.exceptionDate ? dayLabelYear(s.exceptionDate) : weekdaysText(s.daysOfWeek)}</span>
                      {s.prov?.note ? <span className="block text-ink-3 italic">{s.prov.note}</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-ink tnum">{s.closed ? 'Closed' : `${clock(s.opens) ?? '?'}–${clock(s.closes) ?? '?'}`}</td>
                    <td className={cn('py-1.5', s.otherSeason ? 'text-caution' : 'text-ink-2')}>{seasonText(s.seasonId) ?? 'Any'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      ) : null}
      {d.links.find((l) => l.key === 'hours') ? (
        <a
          href={d.links.find((l) => l.key === 'hours')!.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline"
        >
          Official hours page <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pass access

const ACCESS_ICON = { positive: BadgeCheck, caution: KeyRound, critical: XCircle, unknown: CircleHelp } as const
const ACCESS_CLS = { positive: 'text-positive', caution: 'text-caution', critical: 'text-critical', unknown: 'text-ink-2' } as const

function AccessRow({ p }: { p: PassAccessRow }) {
  const vd = p.verdict
  const tone = accessTone(vd.status)
  const Icon = vd.status === 'blackout' ? CalendarX2 : ACCESS_ICON[tone]
  const fam = ((PASS_FAMILIES as readonly string[]).includes(p.familyId) ? p.familyId : 'regional') as PassFamilyId
  // Everything not already on screen goes into Details (positive verdicts restate the headline in reasons[0]).
  const extra = [...(tone === 'positive' ? vd.reasons.slice(0, 1) : []), ...vd.reasons.slice(1), ...(vd.reservationNotes ? [`Reservations: ${vd.reservationNotes}`] : [])].filter(
    (r) => !/^Researched — confirm at source\.?$/.test(r),
  )
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <PassBadge family={fam} size="sm" />
        <span className="text-[14.5px] font-medium text-ink">{p.productName}</span>
        {p.owned ? <span className="inline-flex h-5 items-center rounded-sm bg-copper/12 px-1.5 text-[11.5px] font-semibold text-copper">Your pass</span> : null}
        <Src title={`${p.productName} at this resort`} items={[src(`Access rule: ${p.productName}`, p.ruleProv, vd.headline)]} className="ml-auto" />
      </div>
      <p className={cn('flex items-center gap-1.5 text-[14px] font-semibold', ACCESS_CLS[tone])}>
        <Icon aria-hidden className="size-4 shrink-0" />
        {tone === 'unknown' ? 'Access not confirmed — not permission' : vd.headline}
        <span className="sr-only">({ACCESS_STATUS_LABEL[vd.status]})</span>
      </p>
      {tone !== 'positive' ? <p className="text-[13px] text-ink-2">{vd.reasons[0]}</p> : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        <span>
          {dotJoin(
            vd.reservationRequired === true ? 'Reservation required' : vd.reservationRequired === false ? 'No reservation required' : 'Reservation rules unknown',
            vd.pool ? `Shared pool: ${vd.pool.label ?? vd.pool.id}${vd.pool.total !== null ? ` (${vd.pool.total} days, ${vd.pool.used} used)` : ''}` : null,
            vd.blackout ? `Blackout ${vd.blackout.label ?? `${dayLabel(vd.blackout.from)}–${dayLabel(vd.blackout.to)}`}` : null,
          )}
        </span>
        {vd.confirmAtSource ? <ConfirmTag text="Researched — confirm at source" /> : null}
      </p>
      {extra.length ? (
        <Disclosure summary="Details" className="text-[12.5px] text-ink-2">
          {extra.map((r) => (
            <p key={r} className="mt-1">
              {r}
            </p>
          ))}
        </Disclosure>
      ) : null}
    </li>
  )
}

const TONE_WORD = { positive: 'included', caution: 'discount only', critical: 'not usable', unknown: 'not confirmed' } as const

/** "2 not confirmed, 1 included" — what the folded products say, so nothing important hides behind the fold. */
function accessSummary(rows: readonly PassAccessRow[]): string {
  const counts = new Map<keyof typeof TONE_WORD, number>()
  for (const p of rows) counts.set(accessTone(p.verdict.status), (counts.get(accessTone(p.verdict.status)) ?? 0) + 1)
  return (['positive', 'caution', 'critical', 'unknown'] as const)
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${TONE_WORD[k]}`)
    .join(', ')
}

function AccessBlock({ d, v }: { d: ResortDetail; v: PageView }) {
  const rows = d.passAccess
  const my = d.summary.myPass
  // Your own products (or, without one, the first two) stay in view; other products recorded here are one click away.
  const owned = rows.filter((p) => p.owned)
  const shown = owned.length ? owned : rows.slice(0, 2)
  const rest = rows.filter((p) => !shown.includes(p))
  const folded = rest.length > 1
  const visible = folded ? shown : rows
  return (
    <section aria-labelledby="access-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-5">
      <SubHead id="access-title" aside={<Link href={`/passes?resort=${v.id}&from=${v.date}`} className="text-teal hover:underline">Pass checker</Link>}>
        Tickets &amp; passes on {dayLabel(v.date)}
      </SubHead>
      <p className="-mt-2 mb-3 text-[12.5px] text-ink-3">
        Exact products, not family badges. {my.status === 'no-pass' ? 'You have not recorded a pass — ' : ''}
        {my.status === 'no-pass' ? (
          <Link href="/passes" className="text-teal hover:underline">
            add yours in Passes &amp; Costs
          </Link>
        ) : null}
      </p>
      {rows.length ? (
        <>
          <ul className="flex flex-col divide-y divide-divider">
            {visible.map((p) => (
              <AccessRow key={p.productId} p={p} />
            ))}
          </ul>
          {folded ? (
            <Disclosure
              variant="row"
              className="mt-3 border-t border-divider"
              summary={`${owned.length ? 'Other products' : 'More products'} recorded here (${rest.length}) · ${accessSummary(rest)}`}
            >
              <ul className="flex flex-col divide-y divide-divider pt-1 pb-1">
                {rest.map((p) => (
                  <AccessRow key={p.productId} p={p} />
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </>
      ) : (
        <p className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-3 text-[13.5px] text-ink-2">
          No pass product is recorded for this resort in {d.season.label}. Lift tickets are the only known option.
        </p>
      )}
      <p className="mt-3 border-t border-divider pt-3 text-[12.5px] text-ink-3">Unknown rules are never treated as access. Pass affiliation doesn’t mean you own the pass.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Day basket

function BasketBlock({ d, v }: { d: ResortDetail; v: PageView }) {
  const b = d.basket
  const bands = describeBands()
  const incomplete = b.tier.tier === 'incomplete'
  return (
    <section aria-labelledby="basket-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-5">
      <SubHead id="basket-title" aside={<Link href="/settings" className="text-teal hover:underline">Assumptions</Link>}>
        Day cost per person
      </SubHead>
      <div className="flex items-end justify-between gap-3 border-b border-divider pb-3">
        <div>
          {incomplete ? (
            <p className="font-display text-[28px] leading-none text-caution">Incomplete estimate</p>
          ) : (
            <p className="font-display text-[40px] leading-none text-ink tnum">{formatMoneyRange(b.total, b.totalMax)}</p>
          )}
          <p className="mt-1 text-[12.5px] text-ink-3">
            {dayLabel(v.date)} · {b.holidayName ?? DAY_TYPE_TEXT[b.dayType]} · lift + {RENTAL_LABEL[b.assumptions.rentalOption].toLowerCase()} + lunch + parking
          </p>
        </div>
        {!incomplete ? (
          <span className="rounded-md border border-copper/50 px-2 py-1 font-display text-[22px] leading-none text-copper tnum" title="Expense tier (UI band)">
            {b.tier.tier}
            {b.tierMax ? `–${b.tierMax}` : ''}
          </span>
        ) : null}
      </div>
      <table className="mt-1 w-full text-left text-[13.5px]">
        <caption className="sr-only">Per-person day basket lines</caption>
        <tbody>
          {b.lines.map((l) => {
            const shown = l.display ?? l.amount
            return (
              <tr key={l.key} className="border-b border-divider align-top last:border-b-0">
                <th scope="row" className="py-2 pr-2 font-normal">
                  <span className="block text-ink">{l.label}</span>
                  <span className="block text-[12px] text-ink-3">
                    {dotJoin(l.kind === 'user-estimate' && l.source ? null : l.kind ? LINE_KIND_LABEL[l.kind] : l.required ? 'Required — price unknown' : 'Optional — unknown', l.source, l.note)}
                  </span>
                  {l.confirmAtSource ? <ConfirmTag className="mt-1" /> : null}
                </th>
                <td className="py-2 text-right whitespace-nowrap tnum">
                  {l.kind === 'pass-covered' ? (
                    <span className="font-medium text-positive">Covered</span>
                  ) : shown ? (
                    <span className="font-medium text-ink">{formatMoneyRange(shown, l.displayMax ?? l.amountMax)}</span>
                  ) : (
                    <Missing label="Unknown" />
                  )}
                  {l.fx && l.amount && l.display && l.amount.currency !== l.display.currency ? (
                    <span className="block text-[11.5px] text-ink-3">
                      from {formatMoney(l.amount)} · rate {l.fx.rate}
                      {l.fx.rateDate ? ` (${shortDate(l.fx.rateDate)})` : ''}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {b.missing.length || b.caveats.length ? (
        <ul className="mt-3 flex flex-col gap-0.5 rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
          {b.missing.map((m) => (
            <li key={m.message} className={m.required ? 'font-medium text-caution' : undefined}>
              {m.message}
            </li>
          ))}
          {b.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[12px] text-ink-3 tnum">
        Tier bands ({b.currency}): {bands.map((x) => `${x.tier} ${x.range}`).join(' · ')} — UI classification thresholds, not price estimates. Lessons, lodging and long-distance
        travel are itemised separately.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Price snapshots

const GROUPS: { key: keyof ResortDetail['prices']; label: string }[] = [
  { key: 'tickets', label: 'Lift tickets' },
  { key: 'passes', label: 'Season passes' },
  { key: 'rentals', label: 'Rentals' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'parking', label: 'Parking' },
  { key: 'food', label: 'Food' },
  { key: 'other', label: 'Other' },
]

function PriceRow({ p, planningSeason, tagConfirm }: { p: PriceView; planningSeason: string; tagConfirm: boolean }) {
  return (
    <tr className={cn('border-b border-divider align-top last:border-b-0', p.expired && 'opacity-70')}>
      <th scope="row" className="py-2 pr-2 font-normal">
        <span className="block text-ink">{p.item}</span>
        <span className="block text-[12px] text-ink-3">
          {dotJoin(p.category, p.dayType && p.dayType !== 'any' ? p.dayType : null, p.appliesFrom ? `from ${shortDate(p.appliesFrom)}` : null, p.purchaseBy ? `buy by ${shortDate(p.purchaseBy)}` : null, p.feesText)}
        </span>
        <span className="block text-[12px] sm:hidden">
          <span className={p.seasonId && p.seasonId !== planningSeason ? 'font-medium text-caution' : 'text-ink-2'}>{seasonText(p.seasonId) ?? 'Season not stated'}</span>
          <span className="text-ink-3"> · {p.quoteLabel}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {tagConfirm && p.confirmAtSource ? <ConfirmTag text={confirmText(p.prov)} /> : null}
          {p.expired ? <span className="text-[11.5px] font-medium text-critical">Expired quote</span> : null}
        </span>
      </th>
      <td className="py-2 pr-2 text-right font-medium whitespace-nowrap text-ink tnum">
        {p.amount.amountMinor === 0 && !p.amountMax ? 'Free' : formatMoneyRange(p.amount, p.amountMax)}
        {p.includesTax === false ? <span className="block text-[11.5px] font-normal text-ink-3">before tax</span> : null}
      </td>
      <td className={cn('hidden py-2 pr-2 text-[12.5px] sm:table-cell', p.seasonId && p.seasonId !== planningSeason ? 'font-medium text-caution' : 'text-ink-2')}>{seasonText(p.seasonId) ?? '—'}</td>
      <td className="py-2 text-right">
        <span className="inline-flex items-center gap-1">
          <span className="hidden text-[12px] text-ink-3 md:inline">{p.quoteLabel}</span>
          <Src title={p.item} items={[src(p.item, p.prov, `${formatMoneyRange(p.amount, p.amountMax)} · ${p.quoteLabel} · observed ${shortDate(p.observedAt.slice(0, 10))}`)]} />
        </span>
      </td>
    </tr>
  )
}

type PriceGroup = (typeof GROUPS)[number] & { rows: PriceView[] }

function PriceTable({ groups, planningSeason, tagConfirm, caption }: { groups: PriceGroup[]; planningSeason: string; tagConfirm: boolean; caption: string }) {
  return (
    <table className="w-full text-left text-[13.5px]">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Price</th>
          <th scope="col">Season</th>
          <th scope="col">Quote kind and source</th>
        </tr>
      </thead>
      {groups.map((g, i) => (
        <tbody key={g.key}>
          <tr>
            <th scope="rowgroup" colSpan={4} className={cn('eyebrow pb-1 text-left', i > 0 ? 'pt-5' : 'pt-0')}>
              {g.label}
            </th>
          </tr>
          {g.rows.map((p) => (
            <PriceRow key={p.id} p={p} planningSeason={planningSeason} tagConfirm={tagConfirm} />
          ))}
        </tbody>
      ))}
    </table>
  )
}

/** Rows shown before "N more prices on file" (the first group's first rows). */
const PRICE_ROWS_SHOWN = 4

function PricesBlock({ d, v }: { d: ResortDetail; v: PageView }) {
  const groups: PriceGroup[] = GROUPS.map((g) => ({ ...g, rows: d.prices[g.key] })).filter((g) => g.rows.length)
  const planningSeason = d.season.seasonId
  const otherSeason = groups.some((g) => g.rows.some((p) => p.seasonId && p.seasonId !== planningSeason))
  const all = groups.flatMap((g) => g.rows)
  const allConfirm = all.length > 0 && all.every((p) => p.confirmAtSource)
  const wording = [...new Set(all.map((p) => confirmText(p.prov)))]
  const allTag = wording.length === 1 && wording[0] !== 'Confirm at source' ? `All ${wording[0][0].toLowerCase()}${wording[0].slice(1)}` : 'All: confirm at source'
  const tickets = d.links.find((l) => l.key === 'tickets')
  // Keep the first few rows of the first group in view; fold the rest when that saves real space.
  const head: PriceGroup[] = groups.length ? [{ ...groups[0], rows: groups[0].rows.slice(0, PRICE_ROWS_SHOWN) }] : []
  const tail: PriceGroup[] = groups.length ? [{ ...groups[0], rows: groups[0].rows.slice(PRICE_ROWS_SHOWN) }, ...groups.slice(1)].filter((g) => g.rows.length) : []
  const tailCount = tail.reduce((n, g) => n + g.rows.length, 0)
  const fold = tailCount > 2
  return (
    <section aria-labelledby="prices-title" className="min-w-0 rounded-[12px] border border-divider bg-surface p-5">
      <SubHead id="prices-title" aside={tickets ? <a href={tickets.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal hover:underline">Official prices <ExternalLink aria-hidden className="size-3" /></a> : null}>
        Price snapshots
      </SubHead>
      {groups.length ? (
        <>
          {otherSeason || allConfirm ? (
            <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-caution">
              {allConfirm ? <ConfirmTag text={allTag} /> : null}
              {otherSeason ? <span>Some prices are from another season — shown for reference, not as {seasonText(planningSeason)} prices.</span> : null}
            </div>
          ) : null}
          {fold ? (
            <>
              <PriceTable groups={head} planningSeason={planningSeason} tagConfirm={!allConfirm} caption="Price snapshots, first rows, with season, quote kind and source" />
              <Disclosure
                variant="row"
                className="mt-2 border-t border-divider"
                summary={`${tailCount} more price${tailCount === 1 ? '' : 's'} on file · ${[...new Set(tail.map((g) => g.label.toLowerCase()))].join(', ')}`}
              >
                <div className="pb-1">
                  <PriceTable groups={tail} planningSeason={planningSeason} tagConfirm={!allConfirm} caption="More price snapshots by group, with season, quote kind and source" />
                </div>
              </Disclosure>
            </>
          ) : (
            <PriceTable groups={groups} planningSeason={planningSeason} tagConfirm={!allConfirm} caption="Price snapshots by group, with season, quote kind and source" />
          )}
        </>
      ) : (
        <p className="rounded-[10px] border border-dashed border-divider-strong bg-surface-2 p-3 text-[13.5px] text-ink-2">
          No prices on file for {d.summary.shortName}. Prices are never estimated from other resorts — check the official ticket page.
        </p>
      )}
      <p className="mt-3 border-t border-divider pt-3 text-[12px] text-ink-3">
        Snapshots keep their original currency and are never overwritten. Published prices, observed quotes and your estimates are labelled separately{v.demo ? '; demo prices are simulated' : ''}.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Lessons, rentals, parking, road & transit

function LinkLine({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
      {label} <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(opens {hostOf(href) ?? 'external site'} in a new tab)</span>
    </a>
  )
}

function Practical({ d }: { d: ResortDetail }) {
  const link = (k: string) => d.links.find((l) => l.key === k)?.url ?? null
  const f = d.summary.features
  const transit = d.travel.transfers.filter((t) => t.type === 'bus' || t.type === 'train' || t.type === 'shuttle')
  const cell = 'flex min-w-0 flex-col gap-2 bg-surface p-4'
  const lessonsPrices = d.prices.lessons.length
  const rentalPrices = d.prices.rentals.length
  const parkingPrices = d.prices.parking
  return (
    <div>
      <SubHead>Lessons, rentals, parking and getting around</SubHead>
      <div className="grid gap-px overflow-hidden rounded-[12px] border border-divider bg-divider sm:grid-cols-2 xl:grid-cols-4">
        <div className={cell}>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <GraduationCap aria-hidden className="size-4 text-teal" /> Lessons
          </p>
          <TriChip label="Offered" value={f?.lessons} />
          <p className="text-[12.5px] text-ink-2">{d.summary.beginner.beginnerArea ?? 'Beginner area not described.'}</p>
          <p className="text-[12.5px] text-ink-3">{lessonsPrices ? plural(lessonsPrices, 'lesson price') + ' on file' : 'No lesson prices on file'}</p>
          <LinkLine href={link('lessons')} label="Book lessons" />
        </div>
        <div className={cell}>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Ticket aria-hidden className="size-4 text-teal" /> Rentals
          </p>
          <TriChip label="On site" value={f?.rentals} />
          <p className="text-[12.5px] text-ink-3">{rentalPrices ? plural(rentalPrices, 'rental price') + ' on file' : 'No rental prices on file — the basket shows this line as unknown'}</p>
          <LinkLine href={link('rentals')} label="Rental shop" />
        </div>
        <div className={cell}>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <ParkingSquare aria-hidden className="size-4 text-teal" /> Parking
          </p>
          {parkingPrices.length ? (
            <ul className="text-[13px] text-ink tnum">
              {parkingPrices.map((p) => (
                <li key={p.id}>
                  {p.item}: {formatMoneyRange(p.amount, p.amountMax)} <KindTag kind={p.prov.kind} compact />
                </li>
              ))}
            </ul>
          ) : (
            <Missing label="Parking cost and rules unknown" />
          )}
          <LinkLine href={link('parking')} label="Parking information" />
          {!link('parking') ? <p className="text-[12.5px] text-ink-3">No official parking page recorded.</p> : null}
        </div>
        <div className={cell}>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <TrafficCone aria-hidden className="size-4 text-teal" /> Road &amp; transit
          </p>
          {transit.length ? (
            <ul className="flex flex-col gap-1 text-[13px] text-ink">
              {transit.slice(0, 3).map((t) => (
                <li key={`${t.name}-${t.url}`}>
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
                      {t.name ?? TRANSFER_TYPE_LABEL[t.type ?? ''] ?? 'Transit'}
                    </a>
                  ) : (
                    <span className="font-medium">{t.name ?? 'Transit'}</span>
                  )}
                  {t.type ? <span className="text-ink-3"> · {TRANSFER_TYPE_LABEL[t.type] ?? t.type}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">No public transit recorded.</p>
          )}
          <LinkLine href={link('roadInfo')} label="Road conditions" />
          <a href="#getting-there" className="inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline">
            Getting there <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}
