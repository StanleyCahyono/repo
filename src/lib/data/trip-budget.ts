/**
 * Trip budget refinement shared by trips.ts (summaries, used by Today) and trip-plan.ts (the Trips screens).
 *
 * A planned ski day is a container, not a cost line. Its lift access counts as accounted for when a lift-ticket
 * item covers that day at that resort, or when an owned pass can be used that day (the plan consumes allotments
 * in date order). Otherwise the day stays in `missing` with a reason that says what to add. Nothing else changes:
 * unknown costs are never read as $0, totals stay null until every line is priced.
 */
import 'server-only'
import type { TripItemRow } from '@/lib/db/rows'
import type { TripBudget } from '@/lib/domain/costs'
import { planAccess } from '@/lib/domain/passes'
import type { loadPassData } from './core'

export interface AccountedDay {
  id: TripBudget['missing'][number]['id']
  title: string
  date: string
  resortId: string
  by: 'lift-ticket' | 'pass'
  /** "Alta lift tickets, 3 days" / "Indy Base Pass". */
  detail: string
}

export interface RefinedBudget extends TripBudget {
  /** Ski days whose lift access is priced by a lift-ticket item or covered by an owned pass (not missing). */
  accounted: AccountedDay[]
  /** Priced lines by cost kind — the budget is only ever your estimates, quotes or actuals. */
  kinds: { estimate: number; quote: number; actual: number }
}

type ItemLike = Pick<TripItemRow, 'id' | 'type' | 'refId' | 'date' | 'endDate' | 'costMinor' | 'title'>

/** Does a lift-ticket item price this resort on this date? (single day, or date..endDate inclusive) */
export function liftTicketFor(items: readonly ItemLike[], resortId: string, date: string): ItemLike | null {
  return (
    items.find((i) => {
      if (i.type !== 'lift-ticket' || i.refId !== resortId || !i.date || i.costMinor == null) return false
      const end = i.endDate && i.endDate >= i.date ? i.endDate : i.date
      return date >= i.date && date <= end
    }) ?? null
  )
}

/**
 * Re-evaluate `missing` for planned ski days (see the module note). `passCover` answers "which owned pass can be
 * used on this resort day", or null.
 */
export function refineTripBudget(budget: TripBudget, items: readonly ItemLike[], passCover: (resortId: string, date: string) => string | null): RefinedBudget {
  const byId = new Map(items.map((i) => [i.id, i]))
  const accounted: AccountedDay[] = []
  const missing: TripBudget['missing'] = []
  for (const m of budget.missing) {
    const item = typeof m.id === 'number' ? byId.get(m.id) : undefined
    if (!item || item.type !== 'resort-day' || !item.refId || !item.date || item.costMinor != null) {
      missing.push(m)
      continue
    }
    const ticket = liftTicketFor(items, item.refId, item.date)
    if (ticket) {
      accounted.push({ id: m.id, title: m.title, date: item.date, resortId: item.refId, by: 'lift-ticket', detail: ticket.title })
      continue
    }
    const pass = passCover(item.refId, item.date)
    if (pass) {
      accounted.push({ id: m.id, title: m.title, date: item.date, resortId: item.refId, by: 'pass', detail: pass })
      continue
    }
    missing.push({ ...m, reason: 'Lift access not priced — add a lift ticket, or plan with a pass that covers this day' })
  }
  const complete = missing.length === 0 && budget.unconverted.length === 0
  const kinds = { estimate: 0, quote: 0, actual: 0 }
  for (const l of budget.lines) if (l.groupTotal && l.costKind) kinds[l.costKind] += 1
  return {
    ...budget,
    missing,
    complete,
    total: complete ? budget.group : null,
    perPersonTotal: complete ? budget.perPersonMax : null,
    accounted,
    kinds,
  }
}

/** "Which owned pass (holder me) can be used on this resort day?" — plans consume allotments in date order. */
export function myPassCover(pass: Awaited<ReturnType<typeof loadPassData>>, visits: { resortId: string; date: string }[], today: string, names: Record<string, string>) {
  const covered = new Map<string, string>()
  for (const o of pass.owned.filter((x) => x.ownership.holder === 'me')) {
    const plan = planAccess(
      o.product,
      pass.rules.filter((r) => r.productId === o.product.id),
      visits,
      o.usage,
      { today, names, seasonOf: pass.seasonOf },
    )
    for (const d of plan.days) if (d.verdict.canSki && !covered.has(`${d.resortId}|${d.date}`)) covered.set(`${d.resortId}|${d.date}`, o.product.name)
  }
  return (resortId: string, date: string) => covered.get(`${resortId}|${date}`) ?? null
}
