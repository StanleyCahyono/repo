/**
 * Pass vs tickets reduced to what a person needs: one plain answer, a ranked list of ways to pay for the planned days
 * (each with ONE total on a shared scale), the products that can't be totalled yet in one quiet line, and the data for
 * "when does a pass pay off?". Pure and serializable — the page and its client islands render it.
 *
 * Honesty: a day without a ticket price is never priced; an option is only totalled when every day it has to buy a
 * ticket for has a price. With some ticket prices unknown, a pass can still be called cheaper when its total is below
 * the tickets already known (a lower bound) — and only then.
 */
import type { PassCompareView, ScenarioDay } from '@/lib/data/passes-screen'
import type { CandidateComparison } from '@/lib/domain/costs'
import { formatMoney, money, type Money } from '@/lib/domain/money'
import type { AccessStatus } from '@/lib/domain/passes/types'

export interface OptionDay {
  key: string
  date: string
  resortId: string
  resortName: string
  covered: boolean
  status: AccessStatus
  /** That day's ticket in the display currency; null when unknown. */
  ticket: Money | null
  /** Why the pass doesn't cover the day, in plain words ("blacked out"); null when covered. */
  why: string | null
}

export interface CompareOption {
  /** 'tickets' or the product id. */
  id: string
  kind: 'tickets' | 'pass' | 'owned'
  name: string
  familyId: string | null
  /** One total in the display currency: what you'd pay for these days. Owned passes: only what is still to pay. */
  total: Money | null
  /** Pass price part of the total (0 for an owned pass — already paid). */
  passPart: Money | null
  /** Ticket part: tickets for the days the pass doesn't cover (all days for tickets only). */
  ticketPart: Money | null
  /** Owned only: what you already paid. */
  alreadyPaid: Money | null
  coveredDays: number
  dayCount: number
  /** "Covers 3 of 4 days + $120 in tickets". */
  line: string
  /** Total vs tickets only: positive = saves. null when either side is unknown. */
  savings: Money | null
  /** True for the cheapest totalled option. */
  best: boolean
  days: OptionDay[]
  /** Tickets only, with some day prices unknown: the part that is known. */
  knownSoFar: Money | null
  unknownDays: number
}

export interface QuietProduct {
  id: string
  name: string
  familyId: string
  coveredDays: number
  /** 'price' = no pass price published (or paid price not recorded); 'tickets' = a day it doesn't cover has no ticket price. */
  missing: 'price' | 'tickets'
}

export interface PayoffPass {
  id: string
  name: string
  familyId: string
  price: Money
  /** Average ticket on the planned days this pass covers (display currency). */
  avgTicket: Money
  /** First whole day count at which tickets cost at least the pass. */
  breakEvenDays: number
  coveredDays: number
}

export type AnswerTone = 'tickets' | 'pass' | 'owned' | 'unknown'

export interface CompareAnswer {
  tone: AnswerTone
  /** "Lift tickets are cheapest", "The Ikon Base Pass saves you $212". */
  headline: string
  /** The amount drawn big under the headline (the winning total), when there is one. */
  amount: Money | null
  /** One supporting sentence. */
  detail: string
}

export interface CompareModel {
  dayCount: number
  answer: CompareAnswer
  options: CompareOption[]
  quiet: QuietProduct[]
  /** Products that cover none of the planned days. */
  noCoverage: number
  /** Passes you hold that cover none of these days. */
  ownedUnused: string[]
  /** Largest bar on the shared scale (minor units). */
  scale: number
  payoff: PayoffPass[]
  /** Passes with a price that cover planned days, but none of those days has a ticket price — no break-even yet. */
  payoffNeedsTickets: string[]
}

const WHY: Partial<Record<AccessStatus, string>> = {
  blackout: 'blacked out',
  'days-exhausted': 'no pass days left',
  'not-included': 'not included',
  'discount-only': 'discount only',
  unknown: 'not on this pass',
  'season-mismatch': 'outside the pass season',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const fmt = (m: Money | null | undefined) => formatMoney(m) ?? ''

function daysOf(c: CandidateComparison, byKey: Map<string, ScenarioDay>): OptionDay[] {
  return c.days.map((d) => {
    const sd = byKey.get(`${d.resortId}|${d.date}`)
    return {
      key: `${d.resortId}|${d.date}`,
      date: d.date,
      resortId: d.resortId,
      resortName: sd?.resortName ?? d.resortId,
      covered: d.covered,
      status: d.verdict.status,
      ticket: d.ticket,
      why: d.covered ? null : (WHY[d.verdict.status] ?? 'not covered'),
    }
  })
}

function passLine(c: CandidateComparison): string {
  const n = c.days.length
  if (c.coveredDays === n) return n === 1 ? 'Covers your day' : `Covers all ${n} days`
  const covers = `Covers ${c.coveredDays} of ${n} days`
  if (c.uncoveredTicketCost) return c.uncoveredTicketCost.amountMinor > 0 ? `${covers} + ${fmt(c.uncoveredTicketCost)} in tickets` : covers
  return `${covers} + tickets on ${plural(c.uncovered.count, 'day')}`
}

/** Build the page model from the server view. */
export function compareModel(view: PassCompareView): CompareModel | null {
  const r = view.result
  if (!r) return null
  const cur = r.currency
  const zero = money(0, cur)
  const byKey = new Map(view.days.map((d) => [`${d.resortId}|${d.date}`, d]))
  const n = r.baseline.dayCount
  const baseline = r.baseline.total
  const ticketDays: OptionDay[] = (r.candidates[0]?.days ?? []).map((d) => ({
    key: `${d.resortId}|${d.date}`,
    date: d.date,
    resortId: d.resortId,
    resortName: byKey.get(`${d.resortId}|${d.date}`)?.resortName ?? d.resortId,
    covered: false,
    status: d.verdict.status,
    ticket: d.ticket,
    why: null,
  }))

  const tickets: CompareOption = {
    id: 'tickets',
    kind: 'tickets',
    name: 'Lift tickets only',
    familyId: null,
    total: baseline,
    passPart: null,
    ticketPart: baseline ?? r.baseline.knownTotal,
    alreadyPaid: null,
    coveredDays: 0,
    dayCount: n,
    line: n === 1 ? 'Buy a ticket for the day' : `Buy a ticket each day · ${plural(n, 'day')}`,
    savings: baseline ? zero : null,
    best: false,
    days: ticketDays,
    knownSoFar: baseline ? null : r.baseline.knownTotal,
    unknownDays: r.baseline.unknownDays.length,
  }

  const options: CompareOption[] = [tickets]
  const quiet: QuietProduct[] = []
  let noCoverage = 0
  const ownedUnused: string[] = []
  for (const c of r.candidates) {
    if (c.coveredDays === 0) {
      if (c.owned) ownedUnused.push(c.productName)
      else noCoverage++
      continue
    }
    const total = c.owned ? c.incremental : c.seasonTotal
    // A pass you hold stays listed even without a total (it is yours); others without one get a quiet line.
    if (!total && !c.owned) {
      quiet.push({ id: c.productId, name: c.productName, familyId: c.familyId, coveredDays: c.coveredDays, missing: c.passPrice ? 'tickets' : 'price' })
      continue
    }
    options.push({
      id: c.productId,
      kind: c.owned ? 'owned' : 'pass',
      name: c.productName,
      familyId: c.familyId,
      total,
      passPart: c.owned ? zero : c.passPrice,
      ticketPart: c.uncoveredTicketCost,
      alreadyPaid: c.owned ? c.alreadyPaid : null,
      coveredDays: c.coveredDays,
      dayCount: c.days.length,
      line: passLine(c),
      savings: c.owned ? c.savingsVsTickets : c.seasonSavingsVsTickets,
      best: false,
      days: daysOf(c, byKey),
      knownSoFar: null,
      unknownDays: c.uncoveredUnknownDays,
    })
  }
  quiet.sort((a, b) => b.coveredDays - a.coveredDays || a.name.localeCompare(b.name))

  const kindRank = { owned: 0, tickets: 1, pass: 2 } as const
  // Tickets with some prices unknown rank by what is already known (a lower bound) — never pushed below a dearer pass.
  const sortKey = (o: CompareOption) => (o.total ?? o.knownSoFar)?.amountMinor ?? null
  const ranked = [
    ...options
      .filter((o) => sortKey(o) != null)
      .sort((a, b) => sortKey(a)! - sortKey(b)! || kindRank[a.kind] - kindRank[b.kind] || a.name.localeCompare(b.name)),
    ...options.filter((o) => sortKey(o) == null).sort((a, b) => kindRank[a.kind] - kindRank[b.kind]),
  ]
  const best = ranked.find((o) => o.total) ?? null
  // "Best" only when it is a real comparison: tickets are known, or the pass beats the tickets already known (and
  // nothing ranked above it is a lower bound that might be cheaper).
  const comparable = (o: CompareOption) =>
    !!baseline || (o.kind !== 'tickets' && !!o.total && o.total.amountMinor < r.baseline.knownTotal.amountMinor && ranked[0] === o)
  if (best && comparable(best)) best.best = true

  const scale = Math.max(1, r.baseline.knownTotal.amountMinor, ...ranked.map((o) => (o.passPart?.amountMinor ?? 0) + (o.ticketPart?.amountMinor ?? 0)))

  return {
    dayCount: n,
    answer: answerFor(best && comparable(best) ? best : null, tickets, r.baseline.unknownDays.length, n),
    options: ranked,
    quiet,
    noCoverage,
    ownedUnused,
    scale,
    payoff: payoffPasses(r.candidates),
    payoffNeedsTickets: r.candidates
      .filter((c) => !c.owned && c.passPrice && c.coveredDays > 0 && !c.days.some((d) => d.covered && d.ticket))
      .map((c) => c.productName),
  }
}

function answerFor(best: CompareOption | null, tickets: CompareOption, unknownDays: number, n: number): CompareAnswer {
  const days = plural(n, 'day')
  if (!best) {
    return {
      tone: 'unknown',
      headline: unknownDays ? `${plural(unknownDays, 'day has', 'days have')} no ticket price yet` : 'Nothing to compare yet',
      amount: null,
      detail: unknownDays
        ? `Tickets for the other days come to ${fmt(tickets.knownSoFar)}. Add your own estimate for the missing ${unknownDays === 1 ? 'day' : 'days'} to see the cheapest way.`
        : 'No pass with a price covers these days.',
    }
  }
  if (best.kind === 'tickets') {
    return {
      tone: 'tickets',
      headline: `Lift tickets are cheapest for ${n === 1 ? 'this day' : `these ${days}`}`,
      amount: best.total,
      detail: 'No pass with a published price beats buying a ticket each day.',
    }
  }
  if (best.kind === 'owned') {
    const all = best.coveredDays === best.dayCount
    return {
      tone: 'owned',
      headline: all ? `Your ${best.name} covers ${n === 1 ? 'the day' : `all ${days}`}` : `Your ${best.name} covers ${best.coveredDays} of ${days}`,
      amount: best.total,
      detail: all
        ? 'Nothing more to pay for lift access.'
        : `That is what the other ${plural(best.dayCount - best.coveredDays, 'day')} still cost in tickets${best.savings && best.savings.amountMinor > 0 ? ` — ${fmt(best.savings)} less than buying every ticket` : ''}.`,
    }
  }
  const saves = best.savings
  return {
    tone: 'pass',
    headline: saves && saves.amountMinor > 0 ? `The ${best.name} saves you ${fmt(saves)}` : `The ${best.name} is cheapest`,
    amount: best.total,
    detail: tickets.total
      ? `${best.line}, against ${fmt(tickets.total)} in lift tickets.`
      : `${best.line}. Lift tickets would cost at least ${fmt(tickets.knownSoFar)} — ${plural(tickets.unknownDays, 'day')} still without a price.`,
  }
}

function payoffPasses(candidates: readonly CandidateComparison[]): PayoffPass[] {
  const out: PayoffPass[] = []
  for (const c of candidates) {
    if (c.owned || !c.passPrice || c.coveredDays === 0) continue
    const priced = c.days.filter((d) => d.covered && d.ticket)
    if (!priced.length) continue
    const total = priced.reduce((s, d) => s + d.ticket!.amountMinor, 0)
    const avg = Math.round(total / priced.length)
    if (avg <= 0) continue
    out.push({
      id: c.productId,
      name: c.productName,
      familyId: c.familyId,
      price: c.passPrice,
      avgTicket: money(avg, c.passPrice.currency),
      breakEvenDays: Math.max(1, Math.ceil(c.passPrice.amountMinor / avg)),
      coveredDays: c.coveredDays,
    })
  }
  return out.sort((a, b) => a.breakEvenDays - b.breakEvenDays || a.price.amountMinor - b.price.amountMinor || a.name.localeCompare(b.name)).slice(0, 6)
}
