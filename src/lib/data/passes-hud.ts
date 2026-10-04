/**
 * Read models for the Passes & Costs HUD (the /passes hero and its cards). Builds on the passes read model:
 *
 * - `seasonContextFor` / `getSeasonContext`: where the checked dates sit against the resort's own season row —
 *   before an announced (or actual) opening, inside it, after the closing, or with no announced dates (an estimate is
 *   labelled as one). Announced dates are never a live "open" status; this only says whether the dates fall inside them.
 * - `familyCards`: one card per pass family with the cheapest current adult price on file, else "Price not recorded"
 *   and the official link (Ikon, Epic and Mountain Collective 2026–27 prices are not in the catalog).
 * - `getBreakEven`: a resort season pass against that resort's own day-ticket figures. Ticket figures from an earlier
 *   season are used only as a labelled reference — never as this season's price.
 */
import 'server-only'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { PriceSnapshotRow, ResortSeasonRow } from '@/lib/db/rows'
import { isAdultDayLiftTicket } from '@/lib/domain/costs/items'
import { money, type Money } from '@/lib/domain/money'
import { PASS_FAMILIES } from '@/lib/domain/types'
import { applyOverrides, isLive, loadResortRows, seasonLabel, type DataCtx } from './core'
import type { FamilyView, PassProductView } from './passes'
import { isUnverified, shownSeason } from './shown'

// ---------------------------------------------------------------------------
// Season context for the checked dates

export type SeasonState = 'before' | 'inside' | 'partly' | 'after' | 'unannounced'

export interface SeasonContext {
  state: SeasonState
  /** Actual opening when recorded, else the announced one. */
  opening: string | null
  openingKind: 'actual' | 'announced' | null
  closing: string | null
  closingKind: 'actual' | 'announced' | null
  /** Piste's own estimate when no opening is announced (always labelled as an estimate). */
  estimateFrom: string | null
  /** Every checked date is outside the announced season (before opening or after closing). */
  outside: boolean
}

type SeasonFields = Pick<ResortSeasonRow, 'announcedOpening' | 'actualOpening' | 'announcedClosing' | 'actualClosing' | 'estimatedOpenFrom'>

/** Pure: where [from, to] sits against a resort's season row (null row = nothing announced). */
export function seasonContextFor(row: SeasonFields | null, from: string, to: string): SeasonContext {
  const opening = row?.actualOpening ?? row?.announcedOpening ?? null
  const openingKind = row?.actualOpening ? 'actual' : row?.announcedOpening ? 'announced' : null
  const closing = row?.actualClosing ?? row?.announcedClosing ?? null
  const closingKind = row?.actualClosing ? 'actual' : row?.announcedClosing ? 'announced' : null
  const base = { opening, openingKind, closing, closingKind, estimateFrom: opening ? null : (row?.estimatedOpenFrom ?? null) } as const
  if (opening && to < opening) return { ...base, state: 'before', outside: true }
  if (closing && from > closing) return { ...base, state: 'after', outside: true }
  if (!opening) return { ...base, state: 'unannounced', outside: false }
  const partly = from < opening || (closing != null && to > closing)
  return { ...base, state: partly ? 'partly' : 'inside', outside: false }
}

export async function getSeasonContext(ctx: DataCtx, resortId: string, seasonId: string, from: string, to: string): Promise<SeasonContext> {
  const [rows, resort, ovs] = await Promise.all([
    ctx.db
      .select()
      .from(s.resortSeasons)
      .where(and(eq(s.resortSeasons.resortId, resortId), eq(s.resortSeasons.seasonId, seasonId))),
    loadResortRows(ctx, [resortId]),
    ctx.db.select().from(s.resortOverrides).where(eq(s.resortOverrides.resortId, resortId)),
  ])
  let row: ResortSeasonRow | null = rows[0] ? shownSeason(rows[0]) : null
  if (row && resort[0]) row = applyOverrides(resort[0], row, ovs).season ?? row
  return seasonContextFor(row, from, to)
}

// ---------------------------------------------------------------------------
// Family cards

export interface FamilyCard {
  id: string
  name: string
  productCount: number
  /** Cheapest current adult price on file across the family's products; null = not recorded. */
  price: Money | null
  priceProduct: string | null
  /** A sales statement on file (e.g. "Reports say … sold out"). */
  salesNote: string | null
  officialUrl: string | null
  seasonLabel: string
}

/** Pure: one card per family that has products this season, in family order; the regional card follows my favourites. */
export function familyCards(families: readonly FamilyView[], products: readonly PassProductView[], seasonId: string, favoriteResortIds: ReadonlySet<string>): FamilyCard[] {
  const order = (id: string) => {
    const i = (PASS_FAMILIES as readonly string[]).indexOf(id)
    return i < 0 ? 99 : i
  }
  return [...families]
    .filter((f) => f.productIds.length)
    .sort((a, b) => order(a.id) - order(b.id))
    .map((f): FamilyCard => {
      const ps = products.filter((p) => p.familyId === f.id)
      // Regional passes are per resort: price the one at a favourite resort first, so the card is about a pass you'd use.
      const pool = f.id === 'regional' && ps.some((p) => p.resortId && favoriteResortIds.has(p.resortId)) ? ps.filter((p) => p.resortId && favoriteResortIds.has(p.resortId)) : ps
      const priced = pool
        .filter((p) => p.currentPrice)
        .sort((a, b) => a.currentPrice!.amount.amountMinor - b.currentPrice!.amount.amountMinor)
      const best = priced[0] ?? null
      const sales = ps.map((p) => p.salesDeadline?.text).find((x): x is string => !!x) ?? null
      return {
        id: f.id,
        name: f.id === 'regional' && best ? best.name : f.name,
        productCount: ps.length,
        price: best?.currentPrice?.amount ?? null,
        priceProduct: best?.name ?? null,
        salesNote: sales,
        officialUrl: f.links.official ?? (best?.prov?.sourceUrl ?? null),
        seasonLabel: seasonLabel(seasonId),
      }
    })
}

// ---------------------------------------------------------------------------
// Pass vs lift tickets: break-even at one resort

export interface TicketRef {
  label: string
  amount: Money
  seasonId: string | null
  dayType: string | null
}

export interface BreakEvenView {
  productId: string
  productName: string
  familyId: string
  resortId: string
  resortName: string
  passPrice: Money
  /** 'paid' when it is the price you recorded for your own pass. */
  passPriceKind: 'paid' | 'current'
  owned: boolean
  /** The adult reference ticket (or the highest adult figure), and the lowest adult day ticket when different. */
  typical: TicketRef | null
  low: TicketRef | null
  /** True when the ticket figures are from the planning season itself; false = an earlier season's reference. */
  ticketsThisSeason: boolean
  seasonLabel: string
  /** Ski days logged at the resort this season (journal). */
  daysSkied: number
  sourceUrl: string | null
}

/** Pure: the adult single-day ticket figures that can price a ski day, newest season first. */
export function adultDayTickets(rows: readonly Pick<PriceSnapshotRow, 'item' | 'category' | 'amountMinor' | 'currency' | 'seasonId' | 'dayType' | 'prov'>[], currency: string): TicketRef[] {
  const ok = rows.filter((r) => !isUnverified(r.prov) && r.amountMinor > 0 && r.currency === currency && isAdultDayLiftTicket(r))
  const latest = ok.reduce<string | null>((m, r) => (r.seasonId && (!m || r.seasonId > m) ? r.seasonId : m), null)
  return ok
    .filter((r) => r.seasonId === latest)
    .map((r) => ({ label: r.item, amount: money(r.amountMinor, r.currency), seasonId: r.seasonId, dayType: r.dayType }))
}

export async function getBreakEven(ctx: DataCtx, products: readonly PassProductView[], owned: readonly { productId: string; holder: string; pricePaid: Money | null }[], season: { id: string; start: string }): Promise<BreakEvenView | null> {
  const favorites = new Set((await ctx.db.select({ id: s.favorites.resortId }).from(s.favorites)).map((r) => r.id))
  const mine = new Map(owned.filter((o) => o.holder === 'me').map((o) => [o.productId, o]))
  const candidates = products
    .filter((p) => p.resortId && (mine.get(p.id)?.pricePaid || p.currentPrice))
    .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || Number(favorites.has(b.resortId!)) - Number(favorites.has(a.resortId!)) || a.name.localeCompare(b.name))
  const p = candidates[0]
  if (!p || !p.resortId) return null
  const paid = mine.get(p.id)?.pricePaid ?? null
  const passPrice = paid ?? p.currentPrice!.amount
  const live = isLive(ctx)
  const [tickets, logs] = await Promise.all([
    ctx.db
      .select()
      .from(s.priceSnapshots)
      .where(and(eq(s.priceSnapshots.subjectType, 'lift-ticket'), eq(s.priceSnapshots.subjectId, p.resortId), live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined)),
    ctx.db
      .select({ id: s.skiDayLogs.id })
      .from(s.skiDayLogs)
      .where(and(eq(s.skiDayLogs.resortId, p.resortId), gte(s.skiDayLogs.date, season.start), lte(s.skiDayLogs.date, ctx.today))),
  ])
  const refs = adultDayTickets(tickets, passPrice.currency)
  const adult = refs.filter((r) => /adult/i.test(r.label)).sort((a, b) => b.amount.amountMinor - a.amount.amountMinor)[0]
  const typical = adult ?? [...refs].sort((a, b) => b.amount.amountMinor - a.amount.amountMinor)[0] ?? null
  const lowest = [...refs].sort((a, b) => a.amount.amountMinor - b.amount.amountMinor)[0] ?? null
  return {
    productId: p.id,
    productName: p.name,
    familyId: p.familyId,
    resortId: p.resortId,
    resortName: p.resortName ?? p.resortId,
    passPrice,
    passPriceKind: paid ? 'paid' : 'current',
    owned: mine.has(p.id),
    typical,
    low: lowest && typical && lowest.amount.amountMinor < typical.amount.amountMinor ? lowest : null,
    ticketsThisSeason: !!typical && typical.seasonId === season.id,
    seasonLabel: seasonLabel(season.id),
    daysSkied: logs.length,
    sourceUrl: p.prov?.sourceUrl ?? null,
  }
}

/** Days of tickets that add up to the pass price (fractional; display rounds). */
export function breakEvenDays(pass: Money, ticket: Money): number | null {
  if (pass.currency !== ticket.currency || ticket.amountMinor <= 0) return null
  return pass.amountMinor / ticket.amountMinor
}
