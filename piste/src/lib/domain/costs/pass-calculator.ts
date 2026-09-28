/**
 * Pass comparison on the actual planned resort-day basket.
 *
 * Baseline ("tickets only") = the sum of each planned day's OWN ticket price — never one resort's most expensive
 * walk-up ticket multiplied out. For each candidate product:
 *   season total = pass price + ticket cost of every planned day the pass cannot cover
 *                  (blackout, days exhausted, not included, discount only, unknown rule, wrong season).
 * Owned products split that into "already paid" (sunk) and "incremental" (what the plan still costs).
 *
 * Break-even is shown only when the assumptions fit: a product not yet owned, a known pass price, a known ticket
 * price for every planned day, and the product covering every planned day. It is then the planned day (in date order) on which the
 * cumulative own-day ticket prices reach the pass price. Otherwise the reason is stated instead.
 */
import { formatMoney, money, subtract, sum, type Money } from '../money'
import { planAccess } from '../passes/access'
import {
  ACCESS_STATUS_LABEL,
  type AccessStatus,
  type AccessVerdict,
  type PassProductInput,
  type PassRuleInput,
  type PassUsageInput,
} from '../passes/types'
import { convertMoney, type FxRateRecord } from './fx'

export interface PlannedResortDay {
  resortId: string
  date: string
  /** That day's own lift-ticket price (see liftTicketFor), or null when unknown. */
  ticket: Money | null
  ticketBasis?: string | null
}

export interface PassCandidate {
  product: PassProductInput
  rules: readonly PassRuleInput[]
  /** Purchase price; for an owned product, the price actually paid. null = not recorded. */
  price: Money | null
  priceBasis?: string | null
  /** Present when you already own the product: logged usage consumes its allotments. */
  owned?: { usage: readonly PassUsageInput[] } | null
}

export interface CalcDay {
  index: number
  resortId: string
  date: string
  ticket: Money | null
  ticketOriginal: Money | null
  verdict: AccessVerdict
  covered: boolean
  /** Lift cash for this day with this product: 0 when covered, else the day's ticket; null when unknown. */
  cost: Money | null
}

export interface Baseline {
  /** Sum of each planned day's own ticket price; null if any day's price is unknown. */
  total: Money | null
  knownTotal: Money
  unknownDays: { resortId: string; date: string; reason: string }[]
  dayCount: number
}

export type BreakEven =
  | { status: 'reached'; dayCount: number; onDate: string; resortId: string; explanation: string }
  | { status: 'not-reached'; shortfall: Money; explanation: string }
  | { status: 'not-shown'; explanation: string }

export interface CandidateComparison {
  productId: string
  productName: string
  familyId: string
  owned: boolean
  passPrice: Money | null
  passPriceOriginal: Money | null
  days: CalcDay[]
  coveredDays: number
  uncovered: { count: number; byStatus: Partial<Record<AccessStatus, number>> }
  /** Ticket cost of uncovered days; null if any uncovered day's price is unknown. */
  uncoveredTicketCost: Money | null
  uncoveredKnownCost: Money
  uncoveredUnknownDays: number
  /** Owned only: the sunk purchase price. */
  alreadyPaid: Money | null
  /** What the plan still costs in lift access: owned → uncovered days; not owned → pass price + uncovered days. */
  incremental: Money | null
  /** Pass price + uncovered days. */
  seasonTotal: Money | null
  /** baseline − incremental (positive = the pass option spends less from here on). */
  savingsVsTickets: Money | null
  /** baseline − season total. */
  seasonSavingsVsTickets: Money | null
  breakEven: BreakEven
  notes: string[]
}

export interface PassComparison {
  currency: string
  baseline: Baseline
  candidates: CandidateComparison[]
  notes: string[]
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function comparePasses(input: {
  days: readonly PlannedResortDay[]
  candidates: readonly PassCandidate[]
  currency: string
  rates: readonly FxRateRecord[]
  today?: string | null
  names?: Readonly<Record<string, string>>
}): PassComparison {
  const currency = input.currency.toUpperCase()
  const zero = money(0, currency)
  const today = input.today ?? null

  // Planned days in date order (ties keep input order), each with its own converted ticket price.
  const days = input.days
    .map((d, index) => ({ ...d, index }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index))
    .map((d) => {
      if (!d.ticket) return { ...d, display: null as Money | null, reason: 'Ticket price unknown' }
      const conv = convertMoney(d.ticket, currency, input.rates, { asOf: today })
      return conv
        ? { ...d, display: conv.converted, reason: null }
        : { ...d, display: null, reason: `No stored ${d.ticket.currency}→${currency} rate` }
    })

  const unknownDays = days.filter((d) => !d.display).map((d) => ({ resortId: d.resortId, date: d.date, reason: d.reason! }))
  const knownTotal = sum(days.filter((d) => d.display).map((d) => d.display!), currency)
  const baseline: Baseline = {
    total: unknownDays.length ? null : knownTotal,
    knownTotal,
    unknownDays,
    dayCount: days.length,
  }

  const candidates = input.candidates.map((c): CandidateComparison => {
    const notes: string[] = []
    const owned = !!c.owned
    const plan = planAccess(
      c.product,
      c.rules,
      days.map((d) => ({ resortId: d.resortId, date: d.date })),
      c.owned?.usage ?? [],
      { today, names: input.names },
    )
    const calcDays: CalcDay[] = plan.days.map((p) => {
      const d = days[p.index]
      const covered = p.verdict.canSki
      return {
        index: d.index,
        resortId: d.resortId,
        date: d.date,
        ticket: d.display,
        ticketOriginal: d.ticket,
        verdict: p.verdict,
        covered,
        cost: covered ? zero : d.display,
      }
    })

    let passPrice: Money | null = null
    if (c.price) {
      const conv = convertMoney(c.price, currency, input.rates, { asOf: today })
      if (conv) passPrice = conv.converted
      else notes.push(`No stored ${c.price.currency}→${currency} rate for the pass price.`)
    } else {
      notes.push(owned ? 'Price paid not recorded.' : 'Pass price not recorded.')
    }

    const uncoveredDays = calcDays.filter((d) => !d.covered)
    const byStatus: Partial<Record<AccessStatus, number>> = {}
    for (const d of uncoveredDays) byStatus[d.verdict.status] = (byStatus[d.verdict.status] ?? 0) + 1
    const uncoveredKnownCost = sum(uncoveredDays.filter((d) => d.cost).map((d) => d.cost!), currency)
    const uncoveredUnknownDays = uncoveredDays.filter((d) => !d.cost).length
    const uncoveredTicketCost = uncoveredUnknownDays ? null : uncoveredKnownCost

    if (byStatus['discount-only']) {
      notes.push('Discount-only days are priced at the full ticket price; the discount is not applied.')
    }
    if (byStatus.unknown) {
      notes.push(`${plural(byStatus.unknown, 'day')} with unconfirmed access are priced as tickets, not assumed covered.`)
    }

    const seasonTotal = passPrice && uncoveredTicketCost ? sum([passPrice, uncoveredTicketCost], currency) : null
    const incremental = owned ? uncoveredTicketCost : seasonTotal
    const alreadyPaid = owned ? passPrice : null
    if (owned) notes.push('Already paid — the purchase is a sunk cost; "incremental" is what your plan still costs.')

    return {
      productId: c.product.id,
      productName: c.product.name,
      familyId: c.product.familyId,
      owned,
      passPrice,
      passPriceOriginal: c.price,
      days: calcDays,
      coveredDays: calcDays.length - uncoveredDays.length,
      uncovered: { count: uncoveredDays.length, byStatus },
      uncoveredTicketCost,
      uncoveredKnownCost,
      uncoveredUnknownDays,
      alreadyPaid,
      incremental,
      seasonTotal,
      savingsVsTickets: baseline.total && incremental ? subtract(baseline.total, incremental) : null,
      seasonSavingsVsTickets: baseline.total && seasonTotal ? subtract(baseline.total, seasonTotal) : null,
      breakEven: owned
        ? {
            status: 'not-shown',
            explanation: 'Already bought — break-even is for a purchase decision. Compare the incremental cost with tickets instead.',
          }
        : breakEven(calcDays, passPrice, input.names),
      notes,
    }
  })

  return {
    currency,
    baseline,
    candidates,
    notes: [
      "Tickets-only baseline adds up each planned day's own ticket price for that resort and date.",
      'Lodging, travel, rentals and lessons are the same with or without a pass and are left out.',
    ],
  }
}

function breakEven(days: CalcDay[], passPrice: Money | null, names?: Readonly<Record<string, string>>): BreakEven {
  if (days.length === 0) return { status: 'not-shown', explanation: 'No planned days yet.' }
  if (!passPrice) return { status: 'not-shown', explanation: 'Break-even needs the pass price, which is not recorded.' }
  const unknown = days.filter((d) => !d.ticket)
  if (unknown.length) {
    const list = unknown
      .slice(0, 3)
      .map((d) => `${names?.[d.resortId] ?? d.resortId} ${d.date}`)
      .join(', ')
    return {
      status: 'not-shown',
      explanation: `Ticket prices are missing for ${plural(unknown.length, 'planned day')} (${list}${unknown.length > 3 ? ', …' : ''}), so a break-even would rest on guesses.`,
    }
  }
  const uncovered = days.filter((d) => !d.covered)
  if (uncovered.length) {
    const counts = new Map<AccessStatus, number>()
    for (const d of uncovered) counts.set(d.verdict.status, (counts.get(d.verdict.status) ?? 0) + 1)
    const detail = [...counts.entries()].map(([s, n]) => `${n} ${ACCESS_STATUS_LABEL[s].toLowerCase()}`).join(', ')
    return {
      status: 'not-shown',
      explanation: `The pass does not cover every planned day (${detail}), so a day-count break-even does not fit — compare the totals instead.`,
    }
  }
  let running = 0
  for (let i = 0; i < days.length; i++) {
    running += days[i].ticket!.amountMinor
    if (running >= passPrice.amountMinor) {
      return {
        status: 'reached',
        dayCount: i + 1,
        onDate: days[i].date,
        resortId: days[i].resortId,
        explanation: `Pays for itself on your ${ordinal(i + 1)} planned day (${days[i].date}), counting each day's own ticket price in date order.`,
      }
    }
  }
  const shortfall = money(passPrice.amountMinor - running, passPrice.currency)
  return {
    status: 'not-reached',
    shortfall,
    explanation: `Your ${plural(days.length, 'planned day')} would cost ${formatMoney(money(running, passPrice.currency))} in tickets — ${formatMoney(shortfall)} less than the pass.`,
  }
}
