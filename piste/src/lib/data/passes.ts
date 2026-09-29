/**
 * Passes & Costs read model.
 *
 * - Families and this season's exact products, with every pass price snapshot (quote kind, "confirm at source",
 *   purchase-by window) and the sales deadline with days left.
 * - My owned passes (and other holders'): logged usage, remaining days per resort and per shared day pool.
 * - An access matrix product × resort for one date, answered from product-specific rules only (evaluateAccess):
 *   owned rows count that ownership's logged days; a missing or 'unknown' rule is shown as unknown, never as
 *   included. Family badges elsewhere are discovery only (BADGE_DISCLAIMER).
 * - The pass-vs-tickets comparison on the resort days actually planned in upcoming trips, each day priced with
 *   its own ticket (never one resort's walk-up price multiplied out).
 */
import 'server-only'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { PassAccessRuleRow, PassProductRow, PriceSnapshotRow } from '@/lib/db/rows'
import { comparePasses, isExpired, liftTicketFor, QUOTE_KIND_LABEL, type PassCandidate, type PassComparison } from '@/lib/domain/costs'
import { money, type Money } from '@/lib/domain/money'
import {
  ACCESS_STATUS_LABEL,
  BADGE_DISCLAIMER,
  evaluateAccess,
  latestRule,
  latestRules,
  remainingByPool,
  remainingByResort,
  type AccessStatus,
  type AccessVerdict,
  type PoolAllowance,
  type ResortAllowance,
} from '@/lib/domain/passes'
import { daysBetween, isLocalDate, seasonIdFor } from '@/lib/domain/time'
import { PASS_FAMILIES, type Provenance } from '@/lib/domain/types'
import { groupBy, isLive, loadPassData, loadResortRows, needsConfirmation, seasonLabel, verificationLabel, type DataCtx, type OwnedPass } from './core'

export interface PassPriceView {
  id: number
  category: string | null
  amount: Money
  amountMax: Money | null
  /** Advance-purchase deadline for this price, when the source states one. */
  purchaseBy: string | null
  /** The purchase-by date has passed: no longer on sale at this price. */
  purchaseClosed: boolean
  expired: boolean
  includesTax: boolean | null
  feesText: string | null
  quoteKind: PriceSnapshotRow['quoteKind']
  quoteLabel: string
  observedAt: string
  /** Sale window wording from the source, when recorded. */
  window: string | null
  /** Research-grade or unverified: "Researched — confirm at source". */
  confirmAtSource: boolean
  verificationLabel: string
  prov: Provenance
}

export interface SalesDeadlineView {
  date: string | null
  text: string | null
  /** From home today; negative once passed; null without a date. */
  daysLeft: number | null
  passed: boolean
}

export interface PassProductView {
  id: string
  familyId: string
  familyName: string
  name: string
  seasonId: string
  /** Resort-specific pass: the resort it belongs to. */
  resortId: string | null
  resortName: string | null
  summary: string | null
  blackoutsSummary: string | null
  reservationsSummary: string | null
  renewalNotes: string | null
  salesDeadline: SalesDeadlineView | null
  prices: PassPriceView[]
  /**
   * The adult price you could still buy at today (earliest purchase-by not yet passed, else the newest open-ended
   * price); null = no current price on file — show "Price not recorded", never $0.
   */
  currentPrice: PassPriceView | null
  /** Holders with this product ('me' and/or companions). */
  ownedBy: string[]
  ownedByMe: boolean
  /** Resorts with a current rule that is not 'not-included' (incl. 'unknown' — affiliation, not confirmed access). */
  resortCount: number
  confirmAtSource: boolean
  verificationLabel: string
  prov: Provenance | null
}

export interface FamilyView {
  id: string
  name: string
  operator: string | null
  links: Record<string, string | null>
  productIds: string[]
  prov: Provenance | null
}

export interface UsageView {
  id: number
  date: string
  resortId: string
  resortName: string
  notes: string | null
  /** Inside the product's season (only these consume days). */
  inSeason: boolean
}

export interface OwnedPassView {
  ownershipId: number
  productId: string
  productName: string
  familyId: string
  familyName: string
  holder: string
  purchasedOn: string | null
  /** Price paid, when recorded (null = not recorded, never 0). */
  pricePaid: Money | null
  notes: string | null
  usage: UsageView[]
  /** Distinct resort-days logged in the product's season. */
  daysUsed: number
  byResort: (ResortAllowance & { resortName: string; statusLabel: string })[]
  byPool: (PoolAllowance & { memberNames: string[] })[]
}

export interface AccessCellView {
  resortId: string
  status: AccessStatus
  label: string
  canSki: boolean
  /** A rule exists for this product at this resort (false → "Access not confirmed"). */
  hasRule: boolean
  verdict: AccessVerdict
  ruleProv: Provenance | null
}

export interface AccessRowView {
  /** `own-<ownershipId>` for an owned pass, `product-<productId>` for discovery rows. */
  key: string
  productId: string
  productName: string
  familyId: string
  familyName: string
  ownershipId: number | null
  holder: string | null
  owned: boolean
  /** Aligned with `matrix.resorts`. */
  cells: AccessCellView[]
  counts: Partial<Record<AccessStatus, number>>
}

export interface MatrixResort {
  id: string
  name: string
  shortName: string
  region: string
  isFavorite: boolean
}

export interface PlannedDayView {
  date: string
  resortId: string
  resortName: string
  tripId: string
  tripName: string
  /** That day's own adult lift ticket; null = unknown (never a guess). */
  ticket: Money | null
  ticketBasis: string | null
  ticketConfirmAtSource: boolean
}

export interface PassComparisonView {
  /** Upcoming resort days from non-cancelled trips in the active season, date order. */
  plannedDays: PlannedDayView[]
  /** null when nothing is planned yet. */
  result: PassComparison | null
  notes: string[]
}

export interface PassesView {
  /** Resort-local date the matrix answers for. */
  date: string
  today: string
  season: { id: string; label: string }
  disclaimer: string
  families: FamilyView[]
  products: PassProductView[]
  owned: OwnedPassView[]
  matrix: { date: string; resorts: MatrixResort[]; rows: AccessRowView[]; resortsWithoutRules: { id: string; name: string }[] }
  comparison: PassComparisonView
  notes: string[]
  demo: boolean
}

const familyOrder = (id: string) => {
  const i = (PASS_FAMILIES as readonly string[]).indexOf(id)
  return i === -1 ? PASS_FAMILIES.length : i
}

function priceView(p: PriceSnapshotRow, ctx: DataCtx): PassPriceView {
  return {
    id: p.id,
    category: p.category,
    amount: money(p.amountMinor, p.currency),
    amountMax: p.amountMaxMinor != null && p.amountMaxMinor > p.amountMinor ? money(p.amountMaxMinor, p.currency) : null,
    purchaseBy: p.purchaseBy,
    purchaseClosed: !!p.purchaseBy && isLocalDate(p.purchaseBy.slice(0, 10)) && p.purchaseBy.slice(0, 10) < ctx.today,
    expired: isExpired(p.expiresAt, ctx.now, ctx.today),
    includesTax: p.includesTax,
    feesText: p.feesText,
    quoteKind: p.quoteKind,
    quoteLabel: QUOTE_KIND_LABEL[p.quoteKind] ?? p.quoteKind,
    observedAt: p.observedAt,
    window: p.prov?.note ?? null,
    confirmAtSource: needsConfirmation(p.prov),
    verificationLabel: verificationLabel(p.prov),
    prov: p.prov,
  }
}

/** The adult price still on sale today: earliest purchase-by that has not passed, else the newest open-ended one. */
export function currentPassPrice(prices: readonly PassPriceView[]): PassPriceView | null {
  const open = prices.filter((p) => !p.expired && !p.purchaseClosed && p.quoteKind !== 'demo' && (!p.category || p.category.toLowerCase() === 'adult'))
  const sorted = [...open].sort(
    (a, b) =>
      (a.purchaseBy ?? '9999-12-31').localeCompare(b.purchaseBy ?? '9999-12-31') ||
      (a.quoteKind === 'user-estimate' ? 1 : 0) - (b.quoteKind === 'user-estimate' ? 1 : 0) ||
      b.observedAt.localeCompare(a.observedAt) ||
      b.id - a.id,
  )
  return sorted[0] ?? null
}

function deadlineView(p: PassProductRow, today: string): SalesDeadlineView | null {
  if (!p.salesDeadline && !p.salesDeadlineText) return null
  const date = p.salesDeadline && isLocalDate(p.salesDeadline) ? p.salesDeadline : null
  const daysLeft = date ? daysBetween(today, date) : null
  return { date, text: p.salesDeadlineText, daysLeft, passed: daysLeft !== null && daysLeft < 0 }
}

/** One owned pass with its logged usage and remaining days (shared with My Season). */
export function ownedPassView(o: OwnedPass, rules: readonly PassAccessRuleRow[], names: Readonly<Record<string, string>>, familyName: string): OwnedPassView {
  const productRules = rules.filter((r) => r.productId === o.product.id)
  const name = (id: string) => names[id] ?? id
  const inSeason = o.usage.filter((u) => isLocalDate(u.date) && seasonIdFor(u.date) === o.product.seasonId)
  return {
    ownershipId: o.ownership.id,
    productId: o.product.id,
    productName: o.product.name,
    familyId: o.product.familyId,
    familyName,
    holder: o.ownership.holder,
    purchasedOn: o.ownership.purchasedOn,
    pricePaid: o.ownership.pricePaidMinor != null && o.ownership.currency ? money(o.ownership.pricePaidMinor, o.ownership.currency) : null,
    notes: o.ownership.notes,
    usage: [...o.usage]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((u) => ({ id: u.id, date: u.date, resortId: u.resortId, resortName: name(u.resortId), notes: u.notes, inSeason: inSeason.includes(u) })),
    daysUsed: new Set(inSeason.map((u) => `${u.resortId}|${u.date}`)).size,
    byResort: remainingByResort(o.product, productRules, o.usage).map((a) => ({
      ...a,
      resortName: name(a.resortId),
      statusLabel:
        a.status === 'available'
          ? `${a.remaining} day${a.remaining === 1 ? '' : 's'} left`
          : a.status === 'exhausted'
            ? 'No days left'
            : a.status === 'unlimited'
              ? 'No day limit'
              : a.status === 'discount-only'
                ? 'Discount only'
                : a.status === 'not-included'
                  ? 'Not included'
                  : 'Days not confirmed',
    })),
    byPool: remainingByPool(o.product, productRules, o.usage).map((p) => ({ ...p, memberNames: p.memberResortIds.map(name) })),
  }
}

export async function getPassesView(ctx: DataCtx, opts: { date?: string | null } = {}): Promise<PassesView> {
  const { db, now, today } = ctx
  const live = isLive(ctx)
  const date = opts.date && isLocalDate(opts.date) ? opts.date : today
  const seasonId = ctx.prefs.activeSeasonId
  const [pass, resorts, favRows, trips] = await Promise.all([
    loadPassData(db, seasonId),
    loadResortRows(ctx, null),
    db.select().from(s.favorites),
    db.select().from(s.trips).where(ne(s.trips.status, 'cancelled')),
  ])
  const tripIds = trips.map((t) => t.id)
  const productIds = pass.products.map((p) => p.id)
  const [tripItems, passPrices, fx] = await Promise.all([
    tripIds.length
      ? db
          .select()
          .from(s.tripItems)
          .where(and(inArray(s.tripItems.tripId, tripIds), eq(s.tripItems.type, 'resort-day')))
      : Promise.resolve([]),
    productIds.length
      ? db
          .select()
          .from(s.priceSnapshots)
          .where(and(eq(s.priceSnapshots.subjectType, 'pass-product'), inArray(s.priceSnapshots.subjectId, productIds), live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined))
      : Promise.resolve([] as PriceSnapshotRow[]),
    db.select().from(s.fxRates).where(live ? sql`${s.fxRates.kind} <> 'demo'` : undefined),
  ])

  const names: Record<string, string> = Object.fromEntries(resorts.map((r) => [r.id, r.shortName || r.name]))
  const famName = new Map(pass.families.map((f) => [f.id, f.name]))
  const familyName = (id: string) => famName.get(id) ?? id
  const holdersBy = groupBy(pass.owned, (o) => o.product.id)
  const pricesBy = groupBy(passPrices, (p) => p.subjectId)

  // --- Products ------------------------------------------------------------------------------------------------
  const products: PassProductView[] = [...pass.products]
    .sort((a, b) => familyOrder(a.familyId) - familyOrder(b.familyId) || a.familyId.localeCompare(b.familyId) || a.name.localeCompare(b.name))
    .map((p) => {
      const prices = (pricesBy.get(p.id) ?? [])
        .map((x) => priceView(x, ctx))
        .sort((a, b) => (a.purchaseBy ?? '9999').localeCompare(b.purchaseBy ?? '9999') || (a.category ?? '').localeCompare(b.category ?? '') || b.observedAt.localeCompare(a.observedAt))
      const holders = [...new Set((holdersBy.get(p.id) ?? []).map((o) => o.ownership.holder))]
      return {
        id: p.id,
        familyId: p.familyId,
        familyName: familyName(p.familyId),
        name: p.name,
        seasonId: p.seasonId,
        resortId: p.resortId,
        resortName: p.resortId ? (names[p.resortId] ?? p.resortId) : null,
        summary: p.summary,
        blackoutsSummary: p.blackoutsSummary,
        reservationsSummary: p.reservationsSummary,
        renewalNotes: p.renewalNotes,
        salesDeadline: deadlineView(p, today),
        prices,
        currentPrice: currentPassPrice(prices),
        ownedBy: holders,
        ownedByMe: holders.includes('me'),
        resortCount: latestRules(pass.rules, p.id).filter((r) => r.access !== 'not-included').length,
        confirmAtSource: needsConfirmation(p.prov),
        verificationLabel: verificationLabel(p.prov),
        prov: p.prov,
      }
    })

  const families: FamilyView[] = [...pass.families]
    .sort((a, b) => familyOrder(a.id) - familyOrder(b.id) || a.name.localeCompare(b.name))
    .map((f) => ({ id: f.id, name: f.name, operator: f.operator, links: f.links, productIds: products.filter((p) => p.familyId === f.id).map((p) => p.id), prov: f.prov }))

  const ownedSorted = [...pass.owned].sort((a, b) => Number(b.ownership.holder === 'me') - Number(a.ownership.holder === 'me') || a.ownership.id - b.ownership.id)
  const owned = ownedSorted.map((o) => ownedPassView(o, pass.rules, names, familyName(o.product.familyId)))

  // --- Access matrix -------------------------------------------------------------------------------------------
  const ruleResorts = new Set([...pass.rules.map((r) => r.resortId), ...pass.products.filter((p) => p.resortId).map((p) => p.resortId!)])
  const favIds = new Set(favRows.map((f) => f.resortId))
  const matrixResorts: MatrixResort[] = resorts
    .filter((r) => ruleResorts.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, region: r.region, isFavorite: favIds.has(r.id) }))
  const resortsWithoutRules = resorts.filter((r) => !ruleResorts.has(r.id)).map((r) => ({ id: r.id, name: r.name }))
  const rulesBy = groupBy(pass.rules, (r) => r.productId)

  const row = (product: PassProductRow, ownership: OwnedPass | null): AccessRowView => {
    const productRules = rulesBy.get(product.id) ?? []
    const cells = matrixResorts.map((mr): AccessCellView => {
      const rule = latestRule(productRules, product.id, mr.id)
      const verdict = evaluateAccess({
        product,
        rule,
        resortId: mr.id,
        date,
        usage: ownership?.usage ?? [],
        poolRules: productRules,
        today,
        names,
      })
      return { resortId: mr.id, status: verdict.status, label: ACCESS_STATUS_LABEL[verdict.status], canSki: verdict.canSki, hasRule: !!rule, verdict, ruleProv: rule?.prov ?? null }
    })
    const counts: Partial<Record<AccessStatus, number>> = {}
    for (const c of cells) counts[c.status] = (counts[c.status] ?? 0) + 1
    return {
      key: ownership ? `own-${ownership.ownership.id}` : `product-${product.id}`,
      productId: product.id,
      productName: product.name,
      familyId: product.familyId,
      familyName: familyName(product.familyId),
      ownershipId: ownership?.ownership.id ?? null,
      holder: ownership?.ownership.holder ?? null,
      owned: !!ownership,
      cells,
      counts,
    }
  }
  const mineIds = new Set(pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => o.product.id))
  const productById = new Map(pass.products.map((p) => [p.id, p]))
  const rows: AccessRowView[] = [
    ...ownedSorted.map((o) => row(o.product, o)),
    ...products.filter((p) => !mineIds.has(p.id)).map((p) => row(productById.get(p.id)!, null)),
  ]

  // --- Pass vs tickets on the planned days ---------------------------------------------------------------------
  const tripById = new Map(trips.map((t) => [t.id, t]))
  const planned = tripItems
    .filter((i) => i.refId && i.date && isLocalDate(i.date) && i.date >= today && seasonIdFor(i.date) === seasonId && i.status !== 'idea')
    .sort((a, b) => a.date!.localeCompare(b.date!) || a.id - b.id)
  const plannedResortIds = [...new Set(planned.map((i) => i.refId!))]
  const liftPrices = plannedResortIds.length
    ? await db
        .select()
        .from(s.priceSnapshots)
        .where(
          and(
            eq(s.priceSnapshots.subjectType, 'lift-ticket'),
            inArray(s.priceSnapshots.subjectId, plannedResortIds),
            live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined,
          ),
        )
    : []
  const liftBy = groupBy(liftPrices, (p) => p.resortId ?? p.subjectId)
  const plannedDays: PlannedDayView[] = planned.map((i) => {
    const t = liftTicketFor(liftBy.get(i.refId!) ?? [], i.refId!, i.date!, { now, today })
    const trip = tripById.get(i.tripId)!
    return {
      date: i.date!,
      resortId: i.refId!,
      resortName: names[i.refId!] ?? i.refId!,
      tripId: trip.id,
      tripName: trip.name,
      ticket: t.price,
      ticketBasis: t.basis,
      ticketConfirmAtSource: t.confirmAtSource,
    }
  })
  const comparisonNotes: string[] = []
  let result: PassComparison | null = null
  if (!plannedDays.length) {
    comparisonNotes.push('No upcoming resort days are planned in your trips yet — add resort days to compare passes with tickets.')
  } else {
    const myOwned = new Map(pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => [o.product.id, o]))
    const candidates: PassCandidate[] = pass.products.map((p) => {
      const mine = myOwned.get(p.id)
      const view = products.find((x) => x.id === p.id)!
      const paid = mine && mine.ownership.pricePaidMinor != null && mine.ownership.currency ? money(mine.ownership.pricePaidMinor, mine.ownership.currency) : null
      return {
        product: p,
        rules: rulesBy.get(p.id) ?? [],
        price: mine ? paid : (view.currentPrice?.amount ?? null),
        priceBasis: mine ? (paid ? 'Price you paid' : null) : view.currentPrice ? `${view.currentPrice.quoteLabel}${view.currentPrice.purchaseBy ? `, buy by ${view.currentPrice.purchaseBy}` : ''}` : null,
        owned: mine ? { usage: mine.usage } : null,
      }
    })
    result = comparePasses({ days: plannedDays.map((d) => ({ resortId: d.resortId, date: d.date, ticket: d.ticket, ticketBasis: d.ticketBasis })), candidates, currency: ctx.prefs.currency, rates: fx, today, names })
    if (plannedDays.some((d) => d.ticketConfirmAtSource)) comparisonNotes.push('Some ticket prices are researched — confirm at source.')
    if (products.some((p) => !p.ownedByMe && p.currentPrice?.confirmAtSource)) comparisonNotes.push('Some pass prices are researched — confirm at source.')
  }

  const notes: string[] = [
    BADGE_DISCLAIMER,
    'Access is answered from each product’s own rules for the date; an unknown or missing rule is shown as unknown, never as included.',
  ]
  if (!pass.owned.some((o) => o.ownership.holder === 'me')) notes.push('No pass recorded as yours — resort affiliation never implies ownership.')

  return {
    date,
    today,
    season: { id: seasonId, label: seasonLabel(seasonId) },
    disclaimer: BADGE_DISCLAIMER,
    families,
    products,
    owned,
    matrix: { date, resorts: matrixResorts, rows, resortsWithoutRules },
    comparison: { plannedDays, result, notes: comparisonNotes },
    notes,
    demo: !live,
  }
}
