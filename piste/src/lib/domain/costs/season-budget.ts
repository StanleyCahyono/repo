/**
 * Season budget: actual vs planned by category, cost per ski day, and pass usage value.
 *
 * Never double count a pass:
 * - A pass purchase is counted once. Expenses linked by `passOwnershipId` ARE the purchase (category forced to
 *   'pass', installments summed) and count toward the season of the supplied pass whatever their date — passes
 *   are bought in the spring sale, which falls in the previous season by date. Only when no expense is linked is
 *   the ownership record's price paid used — and an unlinked 'pass' (or, failing that, 'lift') expense of exactly
 *   that amount is treated as the same purchase.
 * - Pass-covered days contribute 0 lift cash. Planned lift items marked pass-covered (or linked to a pass) add
 *   nothing; the pass purchase is never spread into daily cash costs. A logged 'lift' expense on a pass day is
 *   real cash and stays, with a warning to check it is not the pass itself.
 * - "Pass usage value" (tickets you would otherwise have bought) is a separate figure, never added to spending.
 */
import Big from 'big.js'
import { money, subtract, sum, type Money } from '../money'
import { isLocalDate, seasonIdFor } from '../time'
import { convertMoney, type FxRateRecord, type FxRateUsed } from './fx'

export const BUDGET_CATEGORIES = ['pass', 'lift', 'lodging', 'travel', 'food', 'lessons', 'rentals', 'gear', 'other'] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]
/** Categories counted in "on-snow cost per ski day". */
export const ON_SNOW_CATEGORIES: readonly BudgetCategory[] = ['pass', 'lift', 'rentals', 'lessons']

/** Aliases, including trip item types (lift-ticket, rental, lesson, flight, drive, transfer, parking…). */
const CATEGORY_ALIASES: Record<string, BudgetCategory> = {
  'lift-ticket': 'lift',
  ticket: 'lift',
  rental: 'rentals',
  lesson: 'lessons',
  flight: 'travel',
  drive: 'travel',
  transfer: 'travel',
  parking: 'travel',
}

export function normalizeCategory(c: string | null | undefined): BudgetCategory {
  const v = (c ?? '').trim().toLowerCase()
  if ((BUDGET_CATEGORIES as readonly string[]).includes(v)) return v as BudgetCategory
  return CATEGORY_ALIASES[v] ?? 'other'
}

/** Subset of ExpenseRow. */
export interface ExpenseInput {
  id?: number | null
  date: string
  category: string
  label: string
  amountMinor: number
  currency: string
  tripId?: string | null
  passOwnershipId?: number | null
}

export interface OwnedPassInput {
  ownershipId: number
  productName: string
  /** From PassOwnershipRow.pricePaidMinor/currency; null when not recorded. */
  pricePaid: Money | null
  /** Logged pass days (PassUsageRow subset). */
  usage: readonly { resortId: string; date: string }[]
}

export interface PlannedCostInput {
  category: string
  label: string
  amount: Money
  amountMax?: Money | null
  date?: string | null
  /** Links a planned pass purchase, or marks a lift line as covered by that pass. */
  passOwnershipId?: number | null
  /** A planned lift line for a day the pass covers → contributes 0. */
  passCovered?: boolean
}

export interface CategoryLine {
  category: BudgetCategory
  actual: Money
  planned: Money
  plannedMax: Money
  /** actual − planned (positive = over plan). */
  variance: Money
}

export interface PassValue {
  ownershipId: number
  productName: string
  /** Purchase cost counted once in the budget. */
  cost: Money | null
  costSource: 'linked-expenses' | 'matched-expense' | 'pass-record' | null
  daysUsed: number
  costPerDay: Money | null
  /** Sum of each used day's own ticket price; null if any is unknown. */
  ticketValue: Money | null
  ticketValueKnown: Money
  unknownValueDays: number
  /** ticketValue − cost. Not cash saved unless you would have skied those days anyway. */
  netValue: Money | null
}

export interface SeasonBudget {
  currency: string
  seasonId: string | null
  categories: CategoryLine[]
  actualTotal: Money
  plannedTotal: Money
  plannedTotalMax: Money
  seasonBudget: Money | null
  /** seasonBudget − actualTotal. */
  remainingBudget: Money | null
  skiDays: number
  costPerSkiDay: Money | null
  onSnowCostPerSkiDay: Money | null
  passes: PassValue[]
  unconverted: { label: string; original: Money; source: 'expense' | 'planned' | 'pass' }[]
  fxUsed: FxRateUsed[]
  warnings: string[]
  /** Everything converted — false when `unconverted` is non-empty. */
  complete: boolean
}

function divide(m: Money, n: number): Money {
  const v = new Big(m.amountMinor).div(n).round(0, Big.roundHalfUp)
  return money(Number(v.toString()), m.currency)
}

export function computeSeasonBudget(input: {
  currency: string
  rates: readonly FxRateRecord[]
  /** Restrict expenses, planned items, usage and ski days to this season (by date). */
  seasonId?: string | null
  expenses: readonly ExpenseInput[]
  planned?: readonly PlannedCostInput[]
  /** Passes owned for this season. Expenses linked to them are their purchase, whatever the expense date. */
  passes?: readonly OwnedPassInput[]
  /** Logged ski days (SkiDayLogRow subset). Pass usage days are counted as ski days too. */
  skiDays?: readonly { date: string; resortId: string }[]
  /** Own ticket price for pass-used days, for pass usage value. */
  ticketValues?: readonly { resortId: string; date: string; ticket: Money | null }[]
  seasonBudget?: Money | null
  today: string
}): SeasonBudget {
  const currency = input.currency.toUpperCase()
  const zero = money(0, currency)
  const seasonId = input.seasonId ?? null
  const inSeason = (date: string | null | undefined) =>
    !seasonId || (!!date && isLocalDate(date.slice(0, 10)) && seasonIdFor(date.slice(0, 10)) === seasonId)

  const warnings: string[] = []
  const unconverted: SeasonBudget['unconverted'] = []
  const fxUsed = new Map<string, FxRateUsed>()
  const toDisplay = (m: Money, date: string | null | undefined, label: string, source: 'expense' | 'planned' | 'pass') => {
    const conv =
      (date ? convertMoney(m, currency, input.rates, { asOf: date.slice(0, 10) }) : null) ??
      convertMoney(m, currency, input.rates, { asOf: input.today })
    if (!conv) {
      unconverted.push({ label, original: m, source })
      return null
    }
    if (conv.fx.path !== 'identity') fxUsed.set(`${conv.fx.from}>${conv.fx.to}@${conv.fx.rateDate}`, conv.fx)
    return conv.converted
  }

  const actual = new Map<BudgetCategory, Money>(BUDGET_CATEGORIES.map((c) => [c, zero]))
  const planned = new Map<BudgetCategory, Money>(BUDGET_CATEGORIES.map((c) => [c, zero]))
  const plannedMax = new Map<BudgetCategory, Money>(BUDGET_CATEGORIES.map((c) => [c, zero]))
  const addTo = (map: Map<BudgetCategory, Money>, c: BudgetCategory, m: Money) => map.set(c, sum([map.get(c)!, m], currency))

  const passes = input.passes ?? []
  const expenses = input.expenses.filter((e) => inSeason(e.date))

  // --- Pass purchases (counted once) ---------------------------------------------------------------------
  // Linked purchases of the supplied passes are looked up in ALL expenses: a pass for 2026-27 bought on sale in
  // spring 2026 is dated in 2025-26, yet it is this season's pass. (Links to passes not supplied stay date-filtered.)
  const suppliedPassIds = new Set(passes.map((p) => p.ownershipId))
  const linked = new Map<number, ExpenseInput[]>()
  for (const e of input.expenses) {
    if (e.passOwnershipId == null || !suppliedPassIds.has(e.passOwnershipId)) continue
    linked.set(e.passOwnershipId, [...(linked.get(e.passOwnershipId) ?? []), e])
  }
  const consumed = new Set<ExpenseInput>()
  const passCost = new Map<number, { cost: Money | null; source: PassValue['costSource'] }>()

  for (const p of passes) {
    const own = linked.get(p.ownershipId)
    if (own?.length) {
      const converted = own.map((e) => toDisplay(money(e.amountMinor, e.currency), e.date, e.label, 'expense'))
      own.forEach((e) => consumed.add(e))
      const cost = converted.every(Boolean) ? sum(converted as Money[], currency) : null
      converted.forEach((m) => m && addTo(actual, 'pass', m))
      if (p.pricePaid && own.every((e) => e.currency.toUpperCase() === p.pricePaid!.currency)) {
        const paid = own.reduce((a, e) => a + e.amountMinor, 0)
        if (paid !== p.pricePaid.amountMinor) {
          warnings.push(`${p.productName}: linked purchase expenses differ from the recorded price paid; using the expenses.`)
        }
      }
      passCost.set(p.ownershipId, { cost, source: 'linked-expenses' })
      continue
    }
    if (!p.pricePaid) {
      warnings.push(`${p.productName}: price paid is not recorded.`)
      passCost.set(p.ownershipId, { cost: null, source: null })
      continue
    }
    // An unlinked expense of exactly the price paid is the same purchase: a 'pass' expense first, else one logged
    // as 'lift' (otherwise the pass would be counted twice — once as the purchase and once as lift cash).
    const paid = p.pricePaid
    const sameAmount = expenses.filter(
      (e) =>
        !consumed.has(e) &&
        e.passOwnershipId == null &&
        e.amountMinor === paid.amountMinor &&
        e.currency.toUpperCase() === paid.currency,
    )
    const match =
      sameAmount.find((e) => normalizeCategory(e.category) === 'pass') ??
      sameAmount.find((e) => normalizeCategory(e.category) === 'lift')
    if (match) {
      consumed.add(match)
      const asLift = normalizeCategory(match.category) === 'lift' ? ' (logged as lift)' : ''
      warnings.push(
        `"${match.label}"${asLift} looks like the ${p.productName} purchase and is counted once, as the pass — link it to the pass to be sure.`,
      )
    }
    const m = match
      ? toDisplay(money(match.amountMinor, match.currency), match.date, match.label, 'expense')
      : toDisplay(p.pricePaid, null, p.productName, 'pass')
    if (m) addTo(actual, 'pass', m)
    passCost.set(p.ownershipId, { cost: m, source: match ? 'matched-expense' : 'pass-record' })
  }

  // --- Other expenses ----------------------------------------------------------------------------------------
  const passDays = new Set(passes.flatMap((p) => p.usage.filter((u) => inSeason(u.date)).map((u) => u.date)))
  for (const e of expenses) {
    if (consumed.has(e)) continue
    // An expense linked to a pass we were not given is still a pass purchase, counted once here.
    const category = e.passOwnershipId != null ? 'pass' : normalizeCategory(e.category)
    if (category === 'lift' && passDays.has(e.date)) {
      warnings.push(`Lift expense "${e.label}" on ${e.date}, a logged pass day — check it is not the pass itself.`)
    }
    const m = toDisplay(money(e.amountMinor, e.currency), e.date, e.label, 'expense')
    if (m) addTo(actual, category, m)
  }

  // --- Planned -------------------------------------------------------------------------------------------------
  const plannedPass = new Set<number>()
  for (const item of input.planned ?? []) {
    if (item.date && !inSeason(item.date)) continue
    let category = normalizeCategory(item.category)
    if (item.passOwnershipId != null && category !== 'lift') category = 'pass'
    if (category === 'lift' && (item.passCovered || item.passOwnershipId != null)) continue // pass-covered: 0 cash
    if (category === 'pass' && item.passOwnershipId != null) {
      if (plannedPass.has(item.passOwnershipId)) continue
      plannedPass.add(item.passOwnershipId)
    } else if (category === 'pass') {
      // An unlinked planned pass line priced exactly like an owned pass is that pass — planned once, not twice.
      const same = passes.find(
        (p) =>
          !plannedPass.has(p.ownershipId) &&
          p.pricePaid?.amountMinor === item.amount.amountMinor &&
          p.pricePaid.currency === item.amount.currency.toUpperCase(),
      )
      if (same) {
        plannedPass.add(same.ownershipId)
        warnings.push(`Planned "${item.label}" looks like your ${same.productName} and is planned once — link it to the pass to be sure.`)
      }
    }
    const lo = toDisplay(item.amount, item.date, item.label, 'planned')
    if (!lo) continue
    const hi = item.amountMax ? (toDisplay(item.amountMax, item.date, item.label, 'planned') ?? lo) : lo
    addTo(planned, category, lo)
    addTo(plannedMax, category, hi.amountMinor >= lo.amountMinor ? hi : lo)
  }
  // An owned pass is part of the season plan exactly once.
  for (const p of passes) {
    if (plannedPass.has(p.ownershipId)) continue
    const cost = passCost.get(p.ownershipId)?.cost
    if (cost) {
      addTo(planned, 'pass', cost)
      addTo(plannedMax, 'pass', cost)
    }
  }

  // --- Ski days and per-day costs ------------------------------------------------------------------------------
  const skiDates = new Set<string>()
  for (const d of input.skiDays ?? []) if (inSeason(d.date)) skiDates.add(d.date)
  passDays.forEach((d) => skiDates.add(d))
  const skiDays = skiDates.size

  const categories: CategoryLine[] = BUDGET_CATEGORIES.map((category) => ({
    category,
    actual: actual.get(category)!,
    planned: planned.get(category)!,
    plannedMax: plannedMax.get(category)!,
    variance: subtract(actual.get(category)!, planned.get(category)!),
  }))
  const actualTotal = sum(categories.map((c) => c.actual), currency)
  const onSnow = sum(categories.filter((c) => ON_SNOW_CATEGORIES.includes(c.category)).map((c) => c.actual), currency)

  // --- Pass usage value -----------------------------------------------------------------------------------------
  const ticketByDay = new Map((input.ticketValues ?? []).map((t) => [`${t.resortId}|${t.date}`, t.ticket]))
  const passValues: PassValue[] = passes.map((p) => {
    const days = [...new Map(p.usage.filter((u) => inSeason(u.date)).map((u) => [`${u.resortId}|${u.date}`, u])).values()]
    const { cost, source } = passCost.get(p.ownershipId) ?? { cost: null, source: null }
    const values = days.map((u) => {
      const t = ticketByDay.get(`${u.resortId}|${u.date}`) ?? null
      return t ? toDisplay(t, u.date, `${p.productName} day value`, 'pass') : null
    })
    const known = values.filter((v): v is Money => !!v)
    const unknownValueDays = values.length - known.length
    const ticketValueKnown = sum(known, currency)
    const ticketValue = unknownValueDays ? null : ticketValueKnown
    return {
      ownershipId: p.ownershipId,
      productName: p.productName,
      cost,
      costSource: source,
      daysUsed: days.length,
      costPerDay: cost && days.length ? divide(cost, days.length) : null,
      ticketValue,
      ticketValueKnown,
      unknownValueDays,
      netValue: cost && ticketValue ? subtract(ticketValue, cost) : null,
    }
  })

  let seasonBudget: Money | null = null
  if (input.seasonBudget) seasonBudget = toDisplay(input.seasonBudget, null, 'Season budget', 'planned')

  return {
    currency,
    seasonId,
    categories,
    actualTotal,
    plannedTotal: sum(categories.map((c) => c.planned), currency),
    plannedTotalMax: sum(categories.map((c) => c.plannedMax), currency),
    seasonBudget,
    remainingBudget: seasonBudget ? subtract(seasonBudget, actualTotal) : null,
    skiDays,
    costPerSkiDay: skiDays ? divide(actualTotal, skiDays) : null,
    onSnowCostPerSkiDay: skiDays ? divide(onSnow, skiDays) : null,
    passes: passValues,
    unconverted,
    fxUsed: [...fxUsed.values()],
    warnings,
    complete: unconverted.length === 0,
  }
}
