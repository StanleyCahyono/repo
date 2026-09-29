/**
 * Passes & Costs screen loaders (the /passes routes). Builds on the passes read model (families, products, owned
 * passes, access matrix) with:
 *
 * - the access checker: an exact product or one of my ownerships × a resort × a date range → one verdict per day from
 *   planAccess (logged usage and earlier days of the range consume allotments), the rule on file and its versions;
 *   with only a pass chosen it answers "where does it work on these dates", with only a resort "which products work
 *   here". A missing or 'unknown' rule is always shown as unknown — never as permission.
 * - the manual rule editor (current rule, version history, the product's shared pools),
 * - day-cost tiers: the per-person basket for every resort on one date with my saved assumptions (rental option,
 *   lunch estimate, party size) and my passes applied where they cover the day,
 * - the pass-vs-tickets calculator on planned trip days plus scenario days, in a chosen display currency.
 */
import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { BudgetPrefs } from '@/lib/db/schema'
import type { PassAccessRuleRow, PassProductRow, PriceSnapshotRow, UserPreferencesRow } from '@/lib/db/rows'
import {
  comparePasses,
  computeDayBasket,
  describeBands,
  DEFAULT_TIER_BANDS,
  dayTypeFor,
  findRate,
  liftTicketFor,
  type DayBasket,
  type DayType,
  type FxRateRecord,
  type PassCandidate,
  type PassComparison,
  type BasketLineKey,
  type QuoteKind,
  type RentalOption,
} from '@/lib/domain/costs'
import { money, toMajorString, type Money } from '@/lib/domain/money'
import {
  evaluateAccess,
  latestRule,
  latestRules,
  planAccess,
  resolvePool,
  type AccessStatus,
  type AccessVerdict,
  type PassRuleInput,
} from '@/lib/domain/passes'
import { addDays, dateRange, daysBetween, isLocalDate, nextSaturday, seasonIdFor } from '@/lib/domain/time'
import { PASS_FAMILIES, type DateRange, type PassAccessType, type Provenance } from '@/lib/domain/types'
import { groupBy, isLive, loadPassData, loadResortRows, needsConfirmation, seasonLabel, verificationLabel, type DataCtx, type OwnedPass, type PassData } from './core'
import { getPassesView, type PassProductView, type PlannedDayView } from './passes'
import { basketVerdict } from './views'

/** Longest date range the checker answers day by day. */
export const MAX_CHECK_DAYS = 14
/** Most scenario days the calculator takes from the URL. */
export const MAX_SCENARIO_DAYS = 40
/** Party size bounds for the day basket (parking is split across the car). */
export const MAX_PARTY = 12

// ---------------------------------------------------------------------------
// Shared shapes

export interface SeasonInfo {
  id: string
  label: string
  /** Inclusive bounds of the season's dates (1 Jul → 30 Jun). */
  start: string
  end: string
}

export interface ResortOption {
  id: string
  name: string
  shortName: string
  region: string
  country: string
  isFavorite: boolean
}

export interface PassOption {
  /** 'own:<ownershipId>' for a pass someone holds, 'product:<productId>' otherwise. */
  key: string
  productId: string
  ownershipId: number | null
  /** 'me', a companion's name, or null for a product nobody holds. */
  holder: string | null
  name: string
  familyId: string
  familyName: string
}

export interface LinkView {
  label: string
  url: string
}

export interface ProductBrief {
  id: string
  name: string
  familyId: string
  familyName: string
  resortId: string | null
  summary: string | null
  blackoutsSummary: string | null
  reservationsSummary: string | null
  confirmAtSource: boolean
  verificationLabel: string
  prov: Provenance | null
  /** Official pages: the product's source and the family's pages. */
  links: LinkView[]
}

/** One stored version of a product's rule at a resort. */
export interface RuleVersionView {
  id: number
  version: number
  access: PassAccessType
  days: number | null
  poolId: string | null
  poolLabel: string | null
  blackouts: DateRange[]
  /** true/false when known; null = not recorded. */
  reservationRequired: boolean | null
  reservationNotes: string | null
  discountText: string | null
  eligibilityNotes: string | null
  notes: string | null
  /** Entered by you in the rule editor ("Manual — you entered"). */
  youEntered: boolean
  confirmAtSource: boolean
  verificationLabel: string
  updatedAt: string
  prov: Provenance | null
}

export interface PoolView {
  id: string
  label: string | null
  /** Pool size in days; null when no member records it. */
  total: number | null
  used: number
  remaining: number | null
  members: { id: string; name: string; used: number }[]
  conflictingTotals: number[] | null
}

// ---------------------------------------------------------------------------
// Your price estimates (quoteKind 'user-estimate', provider 'You')

export type EstimateSubject = 'lift-ticket' | 'rental' | 'parking' | 'pass-product'
export type EstimateDayType = 'weekday' | 'weekend' | 'holiday' | 'any'
export type EstimateRental = 'full-package' | 'skis-only' | 'boots-only'

/** One of your own estimates, with the values the edit form needs. Never a published price or observed quote. */
export interface EstimateView {
  id: number
  subject: EstimateSubject
  /** Resort id, or the pass product id for a pass-price estimate. */
  subjectId: string
  rentalOption: EstimateRental | null
  dayType: EstimateDayType
  amount: Money
  amountMax: Money | null
  /** Major-unit strings for the edit form ("89.00"). */
  amountMajor: string
  amountMaxMajor: string | null
  /** What you wrote about where the number comes from. */
  note: string | null
  /** When you last entered or edited it (instant). */
  enteredAt: string
}

const ESTIMATE_NOTE_PREFIX = 'Your estimate — '
const RENTALS: readonly string[] = ['full-package', 'skis-only', 'boots-only']
const DAY_TYPES: readonly string[] = ['weekday', 'weekend', 'holiday', 'any']

export function isUserEstimate(p: Pick<PriceSnapshotRow, 'quoteKind'>): boolean {
  return p.quoteKind === 'user-estimate'
}

/** A user-estimate snapshot as an editable view; null for anything else (published, observed, demo). */
export function estimateView(p: Pick<PriceSnapshotRow, 'id' | 'subjectType' | 'subjectId' | 'item' | 'dayType' | 'amountMinor' | 'amountMaxMinor' | 'currency' | 'quoteKind' | 'observedAt' | 'prov'>): EstimateView | null {
  if (p.quoteKind !== 'user-estimate') return null
  if (p.subjectType !== 'lift-ticket' && p.subjectType !== 'rental' && p.subjectType !== 'parking' && p.subjectType !== 'pass-product') return null
  const amount = money(p.amountMinor, p.currency)
  const amountMax = p.amountMaxMinor != null && p.amountMaxMinor > p.amountMinor ? money(p.amountMaxMinor, p.currency) : null
  const note = p.prov?.note ?? null
  return {
    id: p.id,
    subject: p.subjectType,
    subjectId: p.subjectId,
    rentalOption: p.subjectType === 'rental' && RENTALS.includes(p.item) ? (p.item as EstimateRental) : null,
    dayType: p.dayType && DAY_TYPES.includes(p.dayType) ? (p.dayType as EstimateDayType) : 'any',
    amount,
    amountMax,
    amountMajor: toMajorString(amount),
    amountMaxMajor: amountMax ? toMajorString(amountMax) : null,
    note: note && note.startsWith(ESTIMATE_NOTE_PREFIX) ? note.slice(ESTIMATE_NOTE_PREFIX.length) : null,
    enteredAt: p.prov?.fetchedAt ?? p.observedAt,
  }
}

/** Currencies offered when you type an estimate or a price paid: yours first, then common ones. */
export function entryCurrencies(preferred: string): string[] {
  return [...new Set([preferred.toUpperCase(), 'USD', 'CAD', 'EUR', 'CHF', 'GBP', 'JPY'])]
}

export function seasonInfo(seasonId: string): SeasonInfo {
  const start = Number(seasonId.slice(0, 4))
  return { id: seasonId, label: seasonLabel(seasonId), start: `${start}-07-01`, end: `${start + 1}-06-30` }
}

const familyOrder = (id: string) => {
  const i = (PASS_FAMILIES as readonly string[]).indexOf(id)
  return i === -1 ? PASS_FAMILIES.length : i
}

const FAMILY_LINK_LABEL: Record<string, string> = {
  official: 'Official site',
  compare: 'Compare passes',
  restrictedDates: 'Restricted dates',
  blackouts: 'Blackouts & reservations',
  resorts: 'Resort list',
}

function productLinks(product: Pick<PassProductRow, 'prov'>, familyLinks: Record<string, string | null> | undefined): LinkView[] {
  const out: LinkView[] = []
  const seen = new Set<string>()
  const push = (label: string, url: string | null | undefined) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return
    seen.add(url)
    out.push({ label, url })
  }
  push('Product page', product.prov?.sourceUrl)
  for (const [k, url] of Object.entries(familyLinks ?? {})) push(FAMILY_LINK_LABEL[k] ?? k, url)
  return out
}

function brief(p: PassProductRow, pass: PassData): ProductBrief {
  const fam = pass.families.find((f) => f.id === p.familyId)
  return {
    id: p.id,
    name: p.name,
    familyId: p.familyId,
    familyName: fam?.name ?? p.familyId,
    resortId: p.resortId,
    summary: p.summary,
    blackoutsSummary: p.blackoutsSummary,
    reservationsSummary: p.reservationsSummary,
    confirmAtSource: needsConfirmation(p.prov),
    verificationLabel: verificationLabel(p.prov),
    prov: p.prov,
    links: productLinks(p, fam?.links),
  }
}

/** A rule typed into the rule editor carries provider 'You' (see saveAccessRule). */
export function isYouEntered(p: Provenance | null | undefined): boolean {
  return !!p && p.kind === 'manual' && p.provider === 'You'
}

export function ruleVersionView(r: PassAccessRuleRow): RuleVersionView {
  return {
    id: r.id,
    version: r.version,
    access: r.access,
    days: r.days,
    poolId: r.poolId,
    poolLabel: r.poolLabel,
    blackouts: r.blackouts ?? [],
    reservationRequired: r.reservationRequired,
    reservationNotes: r.reservationNotes,
    discountText: r.discountText,
    eligibilityNotes: r.eligibilityNotes,
    notes: r.notes,
    youEntered: isYouEntered(r.prov),
    confirmAtSource: needsConfirmation(r.prov),
    verificationLabel: isYouEntered(r.prov) ? 'Manual — you entered' : verificationLabel(r.prov),
    updatedAt: r.updatedAt,
    prov: r.prov,
  }
}

/** Every stored version for (product, resort), newest first. */
function versionsOf(rules: readonly PassAccessRuleRow[], productId: string, resortId: string): RuleVersionView[] {
  return rules
    .filter((r) => r.productId === productId && r.resortId === resortId)
    .sort((a, b) => b.version - a.version || b.id - a.id)
    .map(ruleVersionView)
}

function resortOptions(rows: Awaited<ReturnType<typeof loadResortRows>>, favorites: ReadonlySet<string>): ResortOption[] {
  return rows.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName || r.name, region: r.region, country: r.country, isFavorite: favorites.has(r.id) }))
}

function passOptions(pass: PassData): PassOption[] {
  const fam = new Map(pass.families.map((f) => [f.id, f.name]))
  const owned = [...pass.owned].sort((a, b) => Number(b.ownership.holder === 'me') - Number(a.ownership.holder === 'me') || a.ownership.id - b.ownership.id)
  const products = [...pass.products].sort((a, b) => familyOrder(a.familyId) - familyOrder(b.familyId) || a.name.localeCompare(b.name))
  return [
    ...owned.map((o) => ({
      key: `own:${o.ownership.id}`,
      productId: o.product.id,
      ownershipId: o.ownership.id,
      holder: o.ownership.holder,
      name: o.product.name,
      familyId: o.product.familyId,
      familyName: fam.get(o.product.familyId) ?? o.product.familyId,
    })),
    ...products.map((p) => ({
      key: `product:${p.id}`,
      productId: p.id,
      ownershipId: null,
      holder: null,
      name: p.name,
      familyId: p.familyId,
      familyName: fam.get(p.familyId) ?? p.familyId,
    })),
  ]
}

function poolView(def: { id: string; label: string | null; memberResortIds: string[]; total: number | null; conflictingTotals: number[] | null }, usage: readonly { resortId: string; date: string }[], seasonId: string, names: Readonly<Record<string, string>>, usedOverride?: number): PoolView {
  const inSeason = usage.filter((u) => isLocalDate(u.date) && seasonIdFor(u.date) === seasonId)
  const usedAt = (id: string) => new Set(inSeason.filter((u) => u.resortId === id).map((u) => u.date)).size
  const used = usedOverride ?? def.memberResortIds.reduce((n, id) => n + usedAt(id), 0)
  return {
    id: def.id,
    label: def.label,
    total: def.total,
    used,
    remaining: def.total == null ? null : Math.max(0, def.total - used),
    members: def.memberResortIds.map((id) => ({ id, name: names[id] ?? id, used: usedAt(id) })),
    conflictingTotals: def.conflictingTotals,
  }
}

async function favoriteSet(ctx: DataCtx): Promise<Set<string>> {
  const rows = await ctx.db.select({ id: s.favorites.resortId }).from(s.favorites)
  return new Set(rows.map((r) => r.id))
}

function namesOf(rows: readonly { id: string; name: string; shortName: string }[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.id, r.shortName || r.name]))
}

function clampToSeason(date: string | null | undefined, season: SeasonInfo, fallback: string): string {
  if (date && isLocalDate(date) && date >= season.start && date <= season.end) return date
  return fallback
}

/** Today when it falls inside the season, else the season's first day. */
export function defaultDate(today: string, season: SeasonInfo): string {
  return today >= season.start && today <= season.end ? today : today < season.start ? season.start : season.end
}

// ---------------------------------------------------------------------------
// Access checker

export interface CheckDay {
  date: string
  verdict: AccessVerdict
}

export interface CheckSummary {
  days: CheckDay[]
  /** Days the pass can be used. */
  covered: number
  byStatus: Partial<Record<AccessStatus, number>>
}

export interface ResortAnswer extends CheckSummary {
  resort: ResortOption
  rule: RuleVersionView | null
}

export interface ProductAnswer extends CheckSummary {
  option: PassOption
  rule: RuleVersionView | null
}

export interface CheckerResult extends CheckSummary {
  product: ProductBrief
  resort: ResortOption
  /** The ownership whose logged days count, when an owned pass was chosen. */
  owned: { ownershipId: number; holder: string; loggedDays: number } | null
  rule: RuleVersionView | null
  /** All stored versions, newest first (rules are versioned, never overwritten). */
  history: RuleVersionView[]
  /** The shared day pool this resort belongs to, with usage before the first day of the range. */
  pool: PoolView | null
}

export interface CheckerView {
  season: SeasonInfo
  today: string
  passes: PassOption[]
  resorts: ResortOption[]
  /** Resorts with a current rule for the chosen product (grouped first in the resort picker). */
  ruleResortIds: string[]
  selection: {
    key: string | null
    productId: string | null
    ownershipId: number | null
    resortId: string | null
    from: string
    to: string
    /** Why the requested dates were adjusted, when they were. */
    note: string | null
  }
  mode: 'empty' | 'pass' | 'resort' | 'both'
  result: CheckerResult | null
  /** mode 'pass': every resort with a rule for the chosen pass, evaluated on the dates. */
  byResort: ResortAnswer[] | null
  /** mode 'resort': every product with a rule at the chosen resort (and my passes), evaluated on the dates. */
  byProduct: ProductAnswer[] | null
  names: Record<string, string>
}

export interface CheckerInput {
  own?: number | null
  /** Product id; 'none' = explicitly no pass (resort mode). */
  pass?: string | null
  resort?: string | null
  from?: string | null
  to?: string | null
}

const RANK: Record<AccessStatus, number> = {
  included: 0,
  'included-limited': 1,
  unknown: 2,
  'discount-only': 3,
  blackout: 4,
  'days-exhausted': 5,
  'not-included': 6,
  'season-mismatch': 7,
}

function summarize(days: CheckDay[]): CheckSummary {
  const byStatus: Partial<Record<AccessStatus, number>> = {}
  for (const d of days) byStatus[d.verdict.status] = (byStatus[d.verdict.status] ?? 0) + 1
  return { days, covered: days.filter((d) => d.verdict.canSki).length, byStatus }
}

/** Worst-first key for sorting answers: covered everywhere, then unknown, then blocked. */
function answerRank(a: CheckSummary): number {
  if (a.days.length && a.covered === a.days.length) return 0
  if (a.covered > 0) return 1
  return 2 + Math.min(...a.days.map((d) => RANK[d.verdict.status] ?? 9))
}

export async function getCheckerView(ctx: DataCtx, input: CheckerInput = {}): Promise<CheckerView> {
  const { today } = ctx
  const season = seasonInfo(ctx.prefs.activeSeasonId)
  const [pass, resortRows, favorites] = await Promise.all([loadPassData(ctx.db, season.id), loadResortRows(ctx, null), favoriteSet(ctx)])
  const resorts = resortOptions(resortRows, favorites)
  const names = namesOf(resortRows)
  const passes = passOptions(pass)
  const productById = new Map(pass.products.map((p) => [p.id, p]))
  const rulesBy = groupBy(pass.rules, (r) => r.productId)

  // --- Selection -----------------------------------------------------------------------------------------------
  let ownership: OwnedPass | null = null
  let productId: string | null = null
  if (input.own != null) ownership = pass.owned.find((o) => o.ownership.id === input.own) ?? null
  if (ownership) productId = ownership.product.id
  else if (input.pass && input.pass !== 'none' && productById.has(input.pass)) productId = input.pass
  else if (input.own == null && !input.pass) {
    // Nothing chosen yet: start from my own pass, if I have one.
    ownership = pass.owned.find((o) => o.ownership.holder === 'me') ?? null
    productId = ownership?.product.id ?? null
  }
  const resort = input.resort ? (resorts.find((r) => r.id === input.resort) ?? null) : null

  const fallback = defaultDate(today, season)
  const from = clampToSeason(input.from, season, fallback)
  let to = input.to && isLocalDate(input.to) && input.to >= from ? input.to : from
  let note: string | null = null
  if (input.from && from !== input.from) note = `Dates are limited to the ${season.label} season (${season.start} to ${season.end}).`
  if (to > season.end) {
    to = season.end
    note = `Dates are limited to the ${season.label} season — the range stops on ${season.end}.`
  }
  if (daysBetween(from, to) >= MAX_CHECK_DAYS) {
    to = addDays(from, MAX_CHECK_DAYS - 1)
    note = `Checked the first ${MAX_CHECK_DAYS} days of the range.`
  }
  const dates = dateRange(from, to)
  const key = ownership ? `own:${ownership.ownership.id}` : productId ? `product:${productId}` : null
  const product = productId ? productById.get(productId)! : null
  const productRules = product ? (rulesBy.get(product.id) ?? []) : []
  const ruleResortIds = product ? latestRules(productRules, product.id).map((r) => r.resortId) : []

  const plan = (p: PassProductRow, rules: readonly PassAccessRuleRow[], resortId: string, usage: readonly { resortId: string; date: string }[]): CheckSummary => {
    const res = planAccess(
      p,
      rules,
      dates.map((date) => ({ resortId, date })),
      usage,
      { today, names },
    )
    return summarize(res.days.map((d) => ({ date: d.date, verdict: d.verdict })))
  }

  const base: Omit<CheckerView, 'mode' | 'result' | 'byResort' | 'byProduct'> = {
    season,
    today,
    passes,
    resorts,
    ruleResortIds,
    selection: { key, productId, ownershipId: ownership?.ownership.id ?? null, resortId: resort?.id ?? null, from, to, note },
    names,
  }

  // --- Pass × resort: day by day ---------------------------------------------------------------------------------
  if (product && resort) {
    const usage = ownership?.usage ?? []
    const summary = plan(product, productRules, resort.id, usage)
    const current = latestRule(productRules, product.id, resort.id) as PassAccessRuleRow | null
    let pool: PoolView | null = null
    if (current?.poolId) {
      const first = summary.days[0]?.verdict.pool
      const def = resolvePool(product.id, current.poolId, productRules as readonly PassRuleInput[])
      pool = poolView(def, usage, product.seasonId, names, first?.used)
    }
    return {
      ...base,
      mode: 'both',
      result: {
        ...summary,
        product: brief(product, pass),
        resort,
        owned: ownership
          ? {
              ownershipId: ownership.ownership.id,
              holder: ownership.ownership.holder,
              loggedDays: new Set(ownership.usage.filter((u) => isLocalDate(u.date) && seasonIdFor(u.date) === product.seasonId).map((u) => `${u.resortId}|${u.date}`)).size,
            }
          : null,
        rule: current ? ruleVersionView(current) : null,
        history: versionsOf(productRules, product.id, resort.id),
        pool,
      },
      byResort: null,
      byProduct: null,
    }
  }

  // --- Pass only: where does it work? -------------------------------------------------------------------------
  if (product) {
    const usage = ownership?.usage ?? []
    const byId = new Map(resorts.map((r) => [r.id, r]))
    const byResort = latestRules(productRules, product.id)
      .map((rule): ResortAnswer | null => {
        const r = byId.get(rule.resortId)
        if (!r) return null
        return { ...plan(product, productRules, r.id, usage), resort: r, rule: ruleVersionView(rule as PassAccessRuleRow) }
      })
      .filter((x): x is ResortAnswer => !!x)
      .sort((a, b) => answerRank(a) - answerRank(b) || Number(b.resort.isFavorite) - Number(a.resort.isFavorite) || a.resort.name.localeCompare(b.resort.name))
    return { ...base, mode: 'pass', result: null, byResort, byProduct: null }
  }

  // --- Resort only: which products work here? -----------------------------------------------------------------
  if (resort) {
    const ruleHere = new Set(pass.rules.filter((r) => r.resortId === resort.id).map((r) => r.productId))
    const byProduct = passes
      .filter((o) => (o.ownershipId != null ? true : ruleHere.has(o.productId)))
      // A product I hold is answered once, as my pass.
      .filter((o) => o.ownershipId != null || !pass.owned.some((x) => x.product.id === o.productId && x.ownership.holder === 'me'))
      .map((o): ProductAnswer => {
        const p = productById.get(o.productId)!
        const rules = rulesBy.get(p.id) ?? []
        const usage = o.ownershipId != null ? (pass.owned.find((x) => x.ownership.id === o.ownershipId)?.usage ?? []) : []
        const current = latestRule(rules, p.id, resort.id) as PassAccessRuleRow | null
        return { ...plan(p, rules, resort.id, usage), option: o, rule: current ? ruleVersionView(current) : null }
      })
      .sort(
        (a, b) =>
          Number(b.option.holder === 'me') - Number(a.option.holder === 'me') ||
          Number(b.option.ownershipId != null) - Number(a.option.ownershipId != null) ||
          answerRank(a) - answerRank(b) ||
          familyOrder(a.option.familyId) - familyOrder(b.option.familyId) ||
          a.option.name.localeCompare(b.option.name),
      )
    return { ...base, mode: 'resort', result: null, byResort: null, byProduct }
  }

  return { ...base, mode: 'empty', result: null, byResort: null, byProduct: null }
}

// ---------------------------------------------------------------------------
// Manual rule editor

export interface RuleEditorView {
  season: SeasonInfo
  product: ProductBrief
  resort: ResortOption
  current: RuleVersionView | null
  history: RuleVersionView[]
  nextVersion: number
  /** Shared pools already defined for this product (to join one), with their current members. */
  pools: PoolView[]
  /** Other resorts with a rule for this product (for the pool explanation). */
  otherRuleResorts: ResortOption[]
}

export async function getRuleEditorView(ctx: DataCtx, productId: string, resortId: string): Promise<RuleEditorView | null> {
  const season = seasonInfo(ctx.prefs.activeSeasonId)
  const [pass, resortRows, favorites] = await Promise.all([loadPassData(ctx.db, season.id), loadResortRows(ctx, null), favoriteSet(ctx)])
  const product = pass.products.find((p) => p.id === productId)
  const resorts = resortOptions(resortRows, favorites)
  const resort = resorts.find((r) => r.id === resortId)
  if (!product || !resort) return null
  const names = namesOf(resortRows)
  const rules = pass.rules.filter((r) => r.productId === product.id)
  const history = versionsOf(rules, product.id, resort.id)
  const current = latestRules(rules, product.id)
  const poolIds = [...new Set(current.filter((r) => r.poolId).map((r) => r.poolId!))].sort()
  const mine = pass.owned.find((o) => o.product.id === product.id && o.ownership.holder === 'me')
  const byId = new Map(resorts.map((r) => [r.id, r]))
  return {
    season,
    product: brief(product, pass),
    resort,
    current: history[0] ?? null,
    history,
    nextVersion: (history[0]?.version ?? 0) + 1,
    pools: poolIds.map((id) => poolView(resolvePool(product.id, id, rules), mine?.usage ?? [], product.seasonId, names)),
    otherRuleResorts: current
      .filter((r) => r.resortId !== resort.id)
      .map((r) => byId.get(r.resortId))
      .filter((r): r is ResortOption => !!r)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ---------------------------------------------------------------------------
// Basket assumptions (saved to preferences)

export interface BasketAssumptionsView {
  rentalOption: RentalOption
  /** My lunch estimate per person, in the budget currency; null when not set (never shown as $0). */
  lunch: Money | null
  /** Currency the lunch estimate is typed in (the budget currency). */
  lunchCurrency: string
  partySize: number
}

/**
 * Party size for the day basket lives in the budget preferences JSON as `basketPartySize` (optional; 1 when absent).
 * It only splits per-vehicle costs such as parking.
 */
export function basketPartySize(prefs: Pick<UserPreferencesRow, 'budget'>): number {
  const raw = (prefs.budget as BudgetPrefs & { basketPartySize?: unknown }).basketPartySize
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_PARTY ? raw : 1
}

export function basketAssumptions(prefs: Pick<UserPreferencesRow, 'budget' | 'gear'>): BasketAssumptionsView {
  const raw = prefs.budget.lunchEstimateMinor as number | null | undefined
  const lunch = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? money(raw, prefs.budget.currency) : null
  return { rentalOption: prefs.gear.rentalOption, lunch, lunchCurrency: prefs.budget.currency.toUpperCase(), partySize: basketPartySize(prefs) }
}

// ---------------------------------------------------------------------------
// Currencies

async function fxRows(ctx: DataCtx): Promise<FxRateRecord[]> {
  return ctx.db.select().from(s.fxRates).where(isLive(ctx) ? sql`${s.fxRates.kind} <> 'demo'` : undefined)
}

/** Display currencies that stored rates can reach from the preferred one (always includes the preferred one). */
export function currencyChoices(preferred: string, rates: readonly FxRateRecord[], today: string): string[] {
  const pref = preferred.toUpperCase()
  const seen = new Set<string>([pref])
  for (const r of rates) for (const c of [r.base.toUpperCase(), r.quote.toUpperCase()]) if (!seen.has(c) && findRate(rates, pref, c, { asOf: today })) seen.add(c)
  return [pref, ...[...seen].filter((c) => c !== pref).sort()]
}

function pickCurrency(requested: string | null | undefined, choices: readonly string[]): string {
  const c = requested?.toUpperCase()
  return c && choices.includes(c) ? c : choices[0]
}

export interface FxNote {
  from: string
  to: string
  /** "1 USD = 1.3705 CAD", or null when no stored rate converts it. */
  rate: string | null
  rateDate: string | null
  provider: string | null
  demo: boolean
}

function fxNotes(currencies: Iterable<string>, to: string, rates: readonly FxRateRecord[], today: string): FxNote[] {
  const out: FxNote[] = []
  for (const from of [...new Set([...currencies].map((c) => c.toUpperCase()))].sort()) {
    if (from === to) continue
    const fx = findRate(rates, from, to, { asOf: today })
    out.push({
      from,
      to,
      rate: fx ? `1 ${from} = ${Number(fx.rate).toFixed(4)} ${to}` : null,
      rateDate: fx?.rateDate ?? null,
      provider: fx?.provider ?? null,
      demo: !!fx?.legs.some((l) => l.kind === 'demo'),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Day costs (expense tiers)

export interface DayCostRow {
  resort: ResortOption
  basket: DayBasket
  /** The pass verdict the basket was priced with (my best pass that day), when I hold one. */
  pass: { productName: string; status: AccessStatus; headline: string; canSki: boolean; confirmAtSource: boolean } | null
  /** Your own lift / rental / parking estimates for this resort this season (any day type), newest first. */
  estimates: EstimateView[]
  /** Provenance behind each priced line: the price snapshot used, or the pass rule that covers lift access. */
  lineProv: Partial<Record<BasketLineKey, Provenance>>
}

export interface DayCostsView {
  season: SeasonInfo
  today: string
  date: string
  dayType: DayType
  holidayName: string | null
  currency: string
  currencies: string[]
  assumptions: BasketAssumptionsView
  bands: { tier: string; range: string }[]
  bandCurrency: string
  rows: DayCostRow[]
  coverage: {
    resorts: number
    /** Complete baskets (every required price known). */
    complete: number
    /** Resorts where a lift price (or my pass) applies on this date. */
    liftOnDate: number
    /** Resorts where a price for the selected rental option applies on this date (null when renting nothing). */
    rentalOnDate: number | null
    /** Resorts with lift prices on file that do not apply to this date (another season, day type or expired). */
    liftNotApplicable: number
  }
  /** My passes applied to the baskets (holder 'me'). */
  myPasses: string[]
  fx: FxNote[]
  /** Currencies offered in the estimate form. */
  entryCurrencies: string[]
  /** Resorts where at least one line of this date's basket is your own estimate. */
  withEstimates: number
}

const BASKET_SUBJECTS = ['lift-ticket', 'rental', 'parking'] as const

export async function getDayCostsView(ctx: DataCtx, opts: { date?: string | null; currency?: string | null } = {}): Promise<DayCostsView> {
  const { now, today, prefs } = ctx
  const season = seasonInfo(prefs.activeSeasonId)
  const date = clampToSeason(opts.date, season, defaultDate(today, season))
  const live = isLive(ctx)
  const [resortRows, favorites, pass, prices, rates] = await Promise.all([
    loadResortRows(ctx, null),
    favoriteSet(ctx),
    loadPassData(ctx.db, season.id),
    ctx.db
      .select()
      .from(s.priceSnapshots)
      .where(and(inArray(s.priceSnapshots.subjectType, [...BASKET_SUBJECTS]), live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined)),
    fxRows(ctx),
  ])
  const currencies = currencyChoices(prefs.currency, rates, today)
  const currency = pickCurrency(opts.currency, currencies)
  const names = namesOf(resortRows)
  const resorts = resortOptions(resortRows, favorites)
  const pricesBy = groupBy(prices, (p) => p.resortId ?? p.subjectId)
  const rulesBy = groupBy(pass.rules, (r) => r.productId)
  const mine = pass.owned.filter((o) => o.ownership.holder === 'me')
  const a = basketAssumptions(prefs)
  const { dayType, holidayName } = dayTypeFor(date)

  const rows: DayCostRow[] = resorts.map((resort) => {
    const verdicts = mine.map((o) => {
      const rules = rulesBy.get(o.product.id) ?? []
      return evaluateAccess({ product: o.product, rule: latestRule(rules, o.product.id, resort.id), resortId: resort.id, date, usage: o.usage, poolRules: rules, today, names })
    })
    const v = basketVerdict(verdicts)
    const resortPrices = pricesBy.get(resort.id) ?? []
    const basket = computeDayBasket(
      { resortId: resort.id, date, prices: resortPrices, pass: v },
      { currency, rentalOption: a.rentalOption, lunch: a.lunch, partySize: a.partySize },
      { now, today, rates },
    )
    return {
      resort,
      basket,
      pass: v ? { productName: v.productName, status: v.status, headline: v.headline, canSki: v.canSki, confirmAtSource: v.confirmAtSource } : null,
      estimates: resortPrices
        .filter((p) => isUserEstimate(p) && (!p.seasonId || p.seasonId === season.id))
        .sort((x, y) => y.observedAt.localeCompare(x.observedAt) || y.id - x.id)
        .map(estimateView)
        .filter((e): e is EstimateView => !!e),
      lineProv: Object.fromEntries(
        basket.lines
          .map((l): [BasketLineKey, Provenance | null | undefined] => [
            l.key,
            l.kind === 'pass-covered' && v
              ? latestRule(rulesBy.get(v.productId) ?? [], v.productId, resort.id)?.prov
              : l.snapshotId != null
                ? resortPrices.find((p) => p.id === l.snapshotId)?.prov
                : null,
          ])
          .filter((e): e is [BasketLineKey, Provenance] => !!e[1]),
      ),
    }
  })

  const liftOnFile = new Set(prices.filter((p) => p.subjectType === 'lift-ticket').map((p) => p.resortId ?? p.subjectId))
  const line = (r: DayCostRow, key: string) => r.basket.lines.find((l) => l.key === key)
  const usedCurrencies = rows.flatMap((r) => r.basket.lines.filter((l) => l.amount).map((l) => l.amount!.currency))
  return {
    season,
    today,
    date,
    dayType,
    holidayName,
    currency,
    currencies,
    assumptions: a,
    bands: describeBands(),
    bandCurrency: DEFAULT_TIER_BANDS.currency,
    rows,
    coverage: {
      resorts: rows.length,
      complete: rows.filter((r) => r.basket.complete && r.basket.total).length,
      liftOnDate: rows.filter((r) => line(r, 'lift')?.amount).length,
      rentalOnDate: a.rentalOption === 'none' ? null : rows.filter((r) => line(r, 'rental')?.amount).length,
      liftNotApplicable: rows.filter((r) => liftOnFile.has(r.resort.id) && !line(r, 'lift')?.amount).length,
    },
    myPasses: mine.map((o) => o.product.name),
    fx: fxNotes(usedCurrencies, currency, rates, today),
    entryCurrencies: entryCurrencies(prefs.currency),
    withEstimates: rows.filter((r) => r.basket.lines.some((l) => l.kind === 'user-estimate' && l.snapshotId != null)).length,
  }
}

// ---------------------------------------------------------------------------
// Pass vs tickets

export interface ScenarioDay {
  /** Stable key: `trip:<tripId>:<resortId>:<date>` or `added:<resortId>:<date>`. */
  key: string
  source: 'trip' | 'added'
  resortId: string
  resortName: string
  date: string
  dayType: DayType
  tripId: string | null
  tripName: string | null
  ticket: Money | null
  ticketBasis: string | null
  ticketConfirmAtSource: boolean
  /** Kind of price behind `ticket` (published, observed quote, your estimate, demo); null when unknown. */
  ticketKind: QuoteKind | null
  /** Your estimate behind `ticket`, when that is what priced the day (editable). */
  ticketEstimate: EstimateView | null
  /** Provenance of the price snapshot behind `ticket`. */
  ticketProv: Provenance | null
}

export interface CandidateMeta {
  productId: string
  familyName: string
  ownedByMe: boolean
  /** Where the pass price comes from ("Price you paid", "Published price, buy by …", "Your estimate"). */
  priceBasis: string | null
  priceConfirmAtSource: boolean
  /** Your own estimate of the pass price, when that is the price used (never for a pass you hold). */
  priceEstimate: EstimateView | null
  /** Provenance of the pass price used (null for a price you paid — that is your own record). */
  priceProv: Provenance | null
  /** A pass price exists on file but no adult price is on sale now (e.g. only child/family categories). */
  otherPricesOnFile: number
  salesClosed: boolean
}

export interface PassCompareView {
  season: SeasonInfo
  today: string
  currency: string
  currencies: string[]
  includeTrips: boolean
  /** Upcoming resort days in trips (whether or not they are included). */
  tripDayCount: number
  days: ScenarioDay[]
  /** Scenario days that were dropped (unknown resort, outside the season, in the past, duplicates). */
  dropped: number
  result: PassComparison | null
  meta: Record<string, CandidateMeta>
  resorts: ResortOption[]
  fx: FxNote[]
  names: Record<string, string>
  /** Currencies offered in the estimate form. */
  entryCurrencies: string[]
}

export interface ScenarioInput {
  resortId: string
  date: string
}

export async function getPassCompareView(ctx: DataCtx, opts: { added?: readonly ScenarioInput[]; includeTrips?: boolean; currency?: string | null } = {}): Promise<PassCompareView> {
  const { now, today, prefs } = ctx
  const season = seasonInfo(prefs.activeSeasonId)
  const includeTrips = opts.includeTrips ?? true
  const [pv, pass, resortRows, favorites, rates] = await Promise.all([getPassesView(ctx), loadPassData(ctx.db, season.id), loadResortRows(ctx, null), favoriteSet(ctx), fxRows(ctx)])
  const currencies = currencyChoices(prefs.currency, rates, today)
  const currency = pickCurrency(opts.currency, currencies)
  const names = namesOf(resortRows)
  const resorts = resortOptions(resortRows, favorites)
  const known = new Set(resorts.map((r) => r.id))

  const tripDays: PlannedDayView[] = pv.comparison.plannedDays
  const seen = new Set<string>(includeTrips ? tripDays.map((d) => `${d.resortId}|${d.date}`) : [])
  const added: ScenarioInput[] = []
  let dropped = 0
  for (const d of (opts.added ?? []).slice(0, MAX_SCENARIO_DAYS)) {
    const k = `${d.resortId}|${d.date}`
    if (!known.has(d.resortId) || !isLocalDate(d.date) || d.date < today || d.date > season.end || seenOrAdd(seen, k)) {
      dropped++
      continue
    }
    added.push(d)
  }
  dropped += Math.max(0, (opts.added?.length ?? 0) - MAX_SCENARIO_DAYS)

  // Every planned day (trip or added) is priced here with its own ticket, the same way, so a day priced by your
  // estimate can say so and be edited.
  const dayResorts = [...new Set([...(includeTrips ? tripDays.map((d) => d.resortId) : []), ...added.map((d) => d.resortId)])]
  const live = isLive(ctx)
  const liftPrices: PriceSnapshotRow[] = dayResorts.length
    ? await ctx.db
        .select()
        .from(s.priceSnapshots)
        .where(and(eq(s.priceSnapshots.subjectType, 'lift-ticket'), inArray(s.priceSnapshots.subjectId, dayResorts), live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined))
    : []
  const liftBy = groupBy(liftPrices, (p) => p.resortId ?? p.subjectId)
  const priced = (resortId: string, date: string) => {
    const prices = liftBy.get(resortId) ?? []
    const t = liftTicketFor(prices, resortId, date, { now, today })
    const snap = t.snapshotId != null ? prices.find((p) => p.id === t.snapshotId) : undefined
    return {
      dayType: t.dayType,
      ticket: t.price,
      ticketBasis: t.basis,
      ticketConfirmAtSource: t.confirmAtSource,
      ticketKind: t.kind,
      ticketEstimate: snap ? estimateView(snap) : null,
      ticketProv: snap?.prov ?? null,
    }
  }

  const days: ScenarioDay[] = [
    ...(includeTrips
      ? tripDays.map((d) => ({
          key: `trip:${d.tripId}:${d.resortId}:${d.date}`,
          source: 'trip' as const,
          resortId: d.resortId,
          resortName: d.resortName,
          date: d.date,
          tripId: d.tripId,
          tripName: d.tripName,
          ...priced(d.resortId, d.date),
        }))
      : []),
    ...added.map((d) => ({
      key: `added:${d.resortId}:${d.date}`,
      source: 'added' as const,
      resortId: d.resortId,
      resortName: names[d.resortId] ?? d.resortId,
      date: d.date,
      tripId: null,
      tripName: null,
      ...priced(d.resortId, d.date),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.resortName.localeCompare(b.resortName))

  const productView = new Map(pv.products.map((p) => [p.id, p]))
  const rulesBy = groupBy(pass.rules, (r) => r.productId)
  const myOwned = new Map(pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => [o.product.id, o]))
  const meta: Record<string, CandidateMeta> = {}
  const candidates: PassCandidate[] = pass.products.map((p) => {
    const mine = myOwned.get(p.id)
    const view = productView.get(p.id) as PassProductView
    const paid = mine && mine.ownership.pricePaidMinor != null && mine.ownership.currency ? money(mine.ownership.pricePaidMinor, mine.ownership.currency) : null
    const cur = view.currentPrice
    const estimate =
      !mine && cur?.quoteKind === 'user-estimate'
        ? estimateView({
            id: cur.id,
            subjectType: 'pass-product',
            subjectId: p.id,
            item: '',
            dayType: 'any',
            amountMinor: cur.amount.amountMinor,
            amountMaxMinor: cur.amountMax?.amountMinor ?? null,
            currency: cur.amount.currency,
            quoteKind: cur.quoteKind,
            observedAt: cur.observedAt,
            prov: cur.prov,
          })
        : null
    const priceBasis = mine
      ? paid
        ? 'Price you paid'
        : null
      : estimate
        ? 'Your estimate — not a published price'
        : cur
          ? `${cur.quoteLabel}${cur.category ? ` · ${cur.category}` : ''}${cur.purchaseBy ? ` · buy by ${cur.purchaseBy.slice(0, 10)}` : ''}`
          : null
    meta[p.id] = {
      productId: p.id,
      familyName: view.familyName,
      ownedByMe: !!mine,
      priceBasis,
      // Your own estimate is labelled as yours, never as research to confirm.
      priceConfirmAtSource: !mine && !estimate && !!cur?.confirmAtSource,
      priceEstimate: estimate,
      priceProv: !mine && cur ? cur.prov : null,
      otherPricesOnFile: view.prices.filter((x) => x.quoteKind !== 'user-estimate').length - (cur && !estimate ? 1 : 0),
      salesClosed: !!view.salesDeadline?.passed,
    }
    return {
      product: p,
      rules: rulesBy.get(p.id) ?? [],
      price: mine ? paid : (view.currentPrice?.amount ?? null),
      priceBasis,
      owned: mine ? { usage: mine.usage } : null,
    }
  })

  const result = days.length
    ? comparePasses({ days: days.map((d) => ({ resortId: d.resortId, date: d.date, ticket: d.ticket, ticketBasis: d.ticketBasis })), candidates, currency, rates, today, names })
    : null

  const originals = [
    ...days.filter((d) => d.ticket).map((d) => d.ticket!.currency),
    ...candidates.filter((c) => c.price).map((c) => c.price!.currency),
  ]
  return {
    season,
    today,
    currency,
    currencies,
    includeTrips,
    tripDayCount: tripDays.length,
    days,
    dropped,
    result,
    meta,
    resorts,
    fx: fxNotes(originals, currency, rates, today),
    names,
    entryCurrencies: entryCurrencies(prefs.currency),
  }
}

function seenOrAdd(seen: Set<string>, k: string): boolean {
  if (seen.has(k)) return true
  seen.add(k)
  return false
}

// ---------------------------------------------------------------------------
// What priced "ticket value" of the days logged on my passes

export interface OwnedValueBasis {
  /** Logged days priced with your own estimate. */
  estimatedDays: number
  /** Logged days priced with a research-grade (confirm at source) price. */
  researchedDays: number
}

/**
 * For each of my passes: how many logged days of this season are valued with your own estimate or a research-grade
 * price (the same per-day ticket lookup the season budget uses), so "value so far" can say so.
 */
export async function ownedValueBasis(ctx: DataCtx): Promise<Record<number, OwnedValueBasis>> {
  const { now, today } = ctx
  const pass = await loadPassData(ctx.db, ctx.prefs.activeSeasonId)
  const mine = pass.owned.filter((o) => o.ownership.holder === 'me')
  const resortIds = [...new Set(mine.flatMap((o) => o.usage.map((u) => u.resortId)))]
  if (!resortIds.length) return {}
  const prices = await ctx.db
    .select()
    .from(s.priceSnapshots)
    .where(and(eq(s.priceSnapshots.subjectType, 'lift-ticket'), inArray(s.priceSnapshots.subjectId, resortIds), isLive(ctx) ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined))
  const by = groupBy(prices, (p) => p.resortId ?? p.subjectId)
  const out: Record<number, OwnedValueBasis> = {}
  for (const o of mine) {
    const days = new Map(o.usage.filter((u) => isLocalDate(u.date) && seasonIdFor(u.date) === o.product.seasonId).map((u) => [`${u.resortId}|${u.date}`, u]))
    const basis: OwnedValueBasis = { estimatedDays: 0, researchedDays: 0 }
    for (const u of days.values()) {
      const t = liftTicketFor(by.get(u.resortId) ?? [], u.resortId, u.date, { now, today })
      if (t.kind === 'user-estimate') basis.estimatedDays += 1
      else if (t.price && t.confirmAtSource) basis.researchedDays += 1
    }
    out[o.ownership.id] = basis
  }
  return out
}

// ---------------------------------------------------------------------------
// Buy-by dates (sales deadlines and advance-price cut-offs)

export interface DeadlineItem {
  productId: string
  productName: string
  familyId: string
  /** Local date; null for a deadline stated only in words. */
  date: string | null
  daysLeft: number | null
  kind: 'price' | 'sales'
  /** The price that ends on this date, when it is a price cut-off. */
  price: Money | null
  category: string | null
  /** The next price on file after this one ends (e.g. the regular price), when recorded. */
  nextPrice: Money | null
  text: string | null
  confirmAtSource: boolean
  prov: Provenance | null
}

/** Upcoming advance-purchase cut-offs and sales deadlines, soonest first; undated statements last. */
export function buyByDates(products: readonly PassProductView[], today: string): DeadlineItem[] {
  const out: DeadlineItem[] = []
  for (const p of products) {
    const open = p.prices.filter((x) => !x.expired && !x.purchaseClosed)
    for (const pr of open) {
      if (!pr.purchaseBy) continue
      const date = pr.purchaseBy.slice(0, 10)
      if (!isLocalDate(date) || date < today) continue
      const later = open
        .filter((x) => x.id !== pr.id && (x.category ?? '') === (pr.category ?? '') && (x.purchaseBy == null || x.purchaseBy.slice(0, 10) > date))
        .sort((a, b) => (a.purchaseBy ?? '9999').localeCompare(b.purchaseBy ?? '9999'))[0]
      out.push({
        productId: p.id,
        productName: p.name,
        familyId: p.familyId,
        date,
        daysLeft: daysBetween(today, date),
        kind: 'price',
        price: pr.amount,
        category: pr.category,
        nextPrice: later?.amount ?? null,
        text: pr.window,
        confirmAtSource: pr.confirmAtSource,
        prov: pr.prov,
      })
    }
    const d = p.salesDeadline
    if (d && !d.passed && (d.date || d.text)) {
      out.push({
        productId: p.id,
        productName: p.name,
        familyId: p.familyId,
        date: d.date,
        daysLeft: d.daysLeft,
        kind: 'sales',
        price: null,
        category: null,
        nextPrice: null,
        text: d.text,
        confirmAtSource: p.confirmAtSource,
        prov: p.prov,
      })
    }
  }
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.productName.localeCompare(b.productName))
}

/** Next Saturday on or after `from`, kept inside the season. */
export function nextSaturdayIn(from: string, season: SeasonInfo): string {
  const d = nextSaturday(from)
  return d > season.end ? season.end : d < season.start ? nextSaturday(season.start) : d
}

