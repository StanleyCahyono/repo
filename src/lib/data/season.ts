/**
 * My Season read model: logged ski days, destinations, the season budget (actual vs planned, cost per ski day,
 * pass value), pass usage with remaining days, the skills checklist and lessons.
 *
 * Budget honesty (computeSeasonBudget):
 * - A pass purchase is counted once: an expense linked to the ownership IS the purchase (whatever its date — passes
 *   are bought in the spring sale), otherwise the recorded price paid. Pass days add no lift cash.
 * - Planned = my share of priced items in non-cancelled trips ('idea' items are not plans). A planned lift ticket on
 *   a day my pass covers is flagged, never silently dropped (only an explicit pass link/flag drops it).
 * - Ski-day logs may carry a spend note; it is not added to the budget (log costs as expenses to count them).
 * Skills are self-reported or instructor-confirmed; nothing here infers ability from spending or distance.
 */
import 'server-only'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { LessonRow, PriceSnapshotRow, SkillRow, TripItemRow, TripRow } from '@/lib/db/rows'
import {
  computeSeasonBudget,
  liftTicketFor,
  normalizeCategory,
  type ExpenseInput,
  type OwnedPassInput,
  type PassValue,
  type PlannedCostInput,
  type SeasonBudget,
} from '@/lib/domain/costs'
import { allocate, formatMoney, money, sum, type Money } from '@/lib/domain/money'
import { evaluateAccess, latestRule } from '@/lib/domain/passes'
import { hemisphereOf, isLocalDate, type SeasonOf } from '@/lib/domain/time'
import type { SurfaceTag } from '@/lib/domain/types'
import { groupBy, isLive, loadPassData, loadResortRows, seasonLabel, type DataCtx } from './core'
import { ownedPassView, type OwnedPassView } from './passes'

export interface SkiDayView {
  id: number
  date: string
  resortId: string
  resortName: string
  tripId: string | null
  tripName: string | null
  /** Personal 1–5 rating of the day. */
  rating: number | null
  surfaceFeedback: SurfaceTag[]
  preferredTime: string | null
  /** A personal guess — never a measured queue or crowd count. */
  crowdGuess: string | null
  skillsPracticed: { id: number; label: string }[]
  hoursSkied: number | null
  /** Vertical metres I recorded (null = not recorded). */
  verticalM: number | null
  /** Spend noted on the day log (null = not recorded, never 0). Not part of the budget — expenses are. */
  spend: Money | null
  notes: string | null
  /** A pass day logged at the same resort and date. */
  passDay: { ownershipId: number; productName: string } | null
}

export interface DestinationView {
  resortId: string
  name: string
  region: string | null
  /** Distinct days skied here this season (ski-day logs and logged pass days). */
  days: number
  passDays: number
  firstDate: string
  lastDate: string
  /** Average of my per-day ratings (null when none). */
  avgDayRating: number | null
  /** My overall rating of the resort (my_ratings), when set. */
  myRating: number | null
}

export type SkillStatus = SkillRow['status']

export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  practicing: 'Practising',
  'not-started': 'Not started',
  'self-confirmed': 'Confirmed by you',
  'instructor-confirmed': 'Confirmed by an instructor',
}

export interface SkillView {
  id: number
  label: string
  category: string | null
  status: SkillStatus
  statusLabel: string
  confirmedOn: string | null
  notes: string | null
  /** Ski days this season that list the skill as practised. */
  practicedDays: number
  lastPracticed: string | null
  /** Lessons this season with the skill as a focus. */
  lessons: number
}

export interface LessonView {
  id: number
  date: string | null
  resortId: string
  resortName: string
  tripId: string | null
  tripName: string | null
  kind: string | null
  instructor: string | null
  focusSkills: { id: number; label: string }[]
  bookingRef: string | null
  bookingUrl: string | null
  /** null = not recorded. */
  cost: Money | null
  costKind: LessonRow['costKind']
  notes: string | null
}

export interface SeasonPassView extends OwnedPassView {
  /** Purchase counted once, days used, ticket value of the days used (only for my passes; null for others'). */
  value: PassValue | null
}

export interface SeasonView {
  season: { id: string; label: string }
  today: string
  /** Newest first. */
  skiDays: SkiDayView[]
  totals: {
    /** Distinct dates with a logged ski day or pass day — the same count the budget divides by. */
    skiDays: number
    loggedDays: number
    resorts: number
    /** Sum of recorded hours; null when no day records hours. */
    hoursSkied: number | null
    daysWithHours: number
    /** Sum of recorded vertical metres; null when no day records vertical. */
    verticalM: number | null
    daysWithVertical: number
    /** Spend noted on ski-day logs, per currency (shown, never added to the budget). */
    dayLogSpend: Money[]
  }
  destinations: DestinationView[]
  budget: SeasonBudget
  /** Plain-language notes about what the budget does and does not include. */
  budgetNotes: string[]
  passes: SeasonPassView[]
  skills: { groups: { status: SkillStatus; label: string; skills: SkillView[] }[]; total: number; practicing: number; confirmed: number; note: string }
  lessons: { upcoming: LessonView[]; past: LessonView[]; undated: LessonView[] }
  demo: boolean
}

const SKILL_ORDER: readonly SkillStatus[] = ['practicing', 'not-started', 'self-confirmed', 'instructor-confirmed']

/** My share of a trip item: per-person amounts as entered, shared amounts split across the party. */
function myShare(amountMinor: number, currency: string, basis: TripItemRow['costBasis'], partySize: number): Money {
  const m = money(amountMinor, currency)
  return basis === 'shared' ? allocate(m, Math.max(1, partySize))[0] : m
}

/**
 * Planned costs from trip items in the season. An item at a resort (a resort day, ticket, lesson…) belongs to that
 * resort's season for its date (`seasonOf`: a Southern Hemisphere winter is the calendar year's); other items follow
 * the planning season's dates.
 */
function plannedFromTrips(trips: readonly TripRow[], items: readonly TripItemRow[], seasonId: string, seasonOf: SeasonOf): { planned: PlannedCostInput[]; ideas: number; unpriced: number } {
  const tripById = new Map(trips.map((t) => [t.id, t]))
  const planned: PlannedCostInput[] = []
  let ideas = 0
  let unpriced = 0
  for (const i of items) {
    const trip = tripById.get(i.tripId)
    if (!trip) continue
    const date = i.date ?? trip.startDate
    if (!isLocalDate(date) || seasonOf(i.refId, date) !== seasonId) continue
    if (i.status === 'idea') {
      ideas += 1
      continue
    }
    if (i.costMinor == null || !i.currency) {
      // Resort days are priced by the day basket, not as items; other unpriced items make "planned" partial.
      if (i.type !== 'resort-day' && i.type !== 'event') unpriced += 1
      continue
    }
    const d = i.details ?? {}
    planned.push({
      category: i.type,
      label: i.title,
      amount: myShare(i.costMinor, i.currency, i.costBasis, trip.partySize),
      amountMax: i.costMaxMinor != null && i.costMaxMinor >= i.costMinor ? myShare(i.costMaxMinor, i.currency, i.costBasis, trip.partySize) : null,
      date,
      passOwnershipId: typeof d.passOwnershipId === 'number' ? d.passOwnershipId : null,
      passCovered: d.passCovered === true,
      resortId: i.refId,
    })
  }
  return { planned, ideas, unpriced }
}

export async function getSeasonView(ctx: DataCtx): Promise<SeasonView> {
  const { db, now, today, prefs } = ctx
  const live = isLive(ctx)
  const seasonId = prefs.activeSeasonId

  const [resorts, pass, dayLogs, expenseRows, trips, skills, lessonRows, ratings, fx] = await Promise.all([
    loadResortRows(ctx, null),
    loadPassData(db, seasonId),
    db.select().from(s.skiDayLogs),
    db.select().from(s.expenses),
    db.select().from(s.trips).where(ne(s.trips.status, 'cancelled')),
    db.select().from(s.skillChecklist),
    db.select().from(s.lessons),
    db.select().from(s.myRatings),
    db.select().from(s.fxRates).where(live ? sql`${s.fxRates.kind} <> 'demo'` : undefined),
  ])
  const tripIds = trips.map((t) => t.id)
  // A day at a resort belongs to that resort's season (a Southern Hemisphere winter — June–October 2027 — is 2026–27).
  const seasonOf = pass.seasonOf
  const atResortInSeason = (resortId: string, d: string | null | undefined) => !!d && isLocalDate(d) && seasonOf(resortId, d) === seasonId
  const mine = pass.owned.filter((o) => o.ownership.holder === 'me')
  const usageMine = mine.flatMap((o) => o.usage.filter((u) => atResortInSeason(u.resortId, u.date)).map((u) => ({ ...u, ownershipId: o.ownership.id, productName: o.product.name })))
  const usedResortIds = [...new Set(usageMine.map((u) => u.resortId))]
  const [tripItems, allTrips, liftPrices] = await Promise.all([
    tripIds.length ? db.select().from(s.tripItems).where(inArray(s.tripItems.tripId, tripIds)) : Promise.resolve([] as TripItemRow[]),
    db.select({ id: s.trips.id, name: s.trips.name }).from(s.trips),
    usedResortIds.length
      ? db
          .select()
          .from(s.priceSnapshots)
          .where(
            and(
              eq(s.priceSnapshots.subjectType, 'lift-ticket'),
              inArray(s.priceSnapshots.subjectId, usedResortIds),
              live ? sql`${s.priceSnapshots.quoteKind} <> 'demo'` : undefined,
            ),
          )
      : Promise.resolve([] as PriceSnapshotRow[]),
  ])

  const byId = new Map(resorts.map((r) => [r.id, r]))
  const name = (id: string) => byId.get(id)?.name ?? id
  const tripName = new Map(allTrips.map((t) => [t.id, t.name]))
  const skillLabel = new Map(skills.map((k) => [k.id, k.label]))
  const skillRefs = (ids: readonly number[]) => ids.filter((id) => skillLabel.has(id)).map((id) => ({ id, label: skillLabel.get(id)! }))
  const passDayAt = new Map(usageMine.map((u) => [`${u.resortId}|${u.date}`, { ownershipId: u.ownershipId, productName: u.productName }]))

  // --- Ski days --------------------------------------------------------------------------------------------------
  const seasonLogs = dayLogs.filter((d) => atResortInSeason(d.resortId, d.date))
  const skiDays: SkiDayView[] = [...seasonLogs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map((d) => ({
      id: d.id,
      date: d.date,
      resortId: d.resortId,
      resortName: name(d.resortId),
      tripId: d.tripId,
      tripName: d.tripId ? (tripName.get(d.tripId) ?? null) : null,
      rating: d.rating,
      surfaceFeedback: d.surfaceFeedback,
      preferredTime: d.preferredTime,
      crowdGuess: d.crowdGuess,
      skillsPracticed: skillRefs(d.skillsPracticed),
      hoursSkied: d.hoursSkied,
      verticalM: d.verticalM ?? null,
      spend: d.spendMinor != null && d.currency ? money(d.spendMinor, d.currency) : null,
      notes: d.notes,
      passDay: passDayAt.get(`${d.resortId}|${d.date}`) ?? null,
    }))

  const skiDates = new Set([...seasonLogs.map((d) => d.date), ...usageMine.map((u) => u.date)])
  const withHours = seasonLogs.filter((d) => typeof d.hoursSkied === 'number' && Number.isFinite(d.hoursSkied))
  const withVertical = seasonLogs.filter((d) => typeof d.verticalM === 'number' && Number.isFinite(d.verticalM))
  const spendByCur = groupBy(
    skiDays.filter((d) => d.spend),
    (d) => d.spend!.currency,
  )
  const dayLogSpend = [...spendByCur].map(([cur, list]) => sum(list.map((d) => d.spend!), cur))

  // --- Destinations --------------------------------------------------------------------------------------------
  const visits = [...seasonLogs.map((d) => ({ resortId: d.resortId, date: d.date, rating: d.rating, pass: false })), ...usageMine.map((u) => ({ resortId: u.resortId, date: u.date, rating: null, pass: true }))]
  const myRating = new Map(ratings.map((r) => [r.resortId, r.rating]))
  const destinations: DestinationView[] = [...groupBy(visits, (v) => v.resortId)]
    .map(([resortId, list]) => {
      const dates = [...new Set(list.map((v) => v.date))].sort()
      const rated = seasonLogs.filter((d) => d.resortId === resortId && typeof d.rating === 'number').map((d) => d.rating!)
      return {
        resortId,
        name: name(resortId),
        region: byId.get(resortId)?.region ?? null,
        days: dates.length,
        passDays: new Set(list.filter((v) => v.pass).map((v) => v.date)).size,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        avgDayRating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
        myRating: myRating.get(resortId) ?? null,
      }
    })
    .sort((a, b) => b.days - a.days || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name))

  // --- Budget ----------------------------------------------------------------------------------------------------
  const expenses: ExpenseInput[] = expenseRows.map((e) => ({
    id: e.id,
    date: e.date,
    category: e.category,
    label: e.label,
    amountMinor: e.amountMinor,
    currency: e.currency,
    tripId: e.tripId,
    passOwnershipId: e.passOwnershipId,
  }))
  const { planned, ideas, unpriced } = plannedFromTrips(trips, tripItems, seasonId, seasonOf)
  const passes: OwnedPassInput[] = mine.map((o) => ({
    ownershipId: o.ownership.id,
    productName: o.product.name,
    pricePaid: o.ownership.pricePaidMinor != null && o.ownership.currency ? money(o.ownership.pricePaidMinor, o.ownership.currency) : null,
    usage: o.usage,
  }))
  const liftBy = groupBy(liftPrices, (p) => p.resortId ?? p.subjectId)
  const ticketValues = usageMine.map((u) => {
    const r = byId.get(u.resortId)
    const ticket = liftTicketFor(liftBy.get(u.resortId) ?? [], u.resortId, u.date, { now, today, country: r ? r.country : null, hemisphere: hemisphereOf(r?.lat) }).price
    return { resortId: u.resortId, date: u.date, ticket }
  })
  const budget = computeSeasonBudget({
    currency: prefs.currency,
    rates: fx,
    seasonId,
    seasonOf,
    expenses,
    planned,
    passes,
    skiDays: seasonLogs.map((d) => ({ date: d.date, resortId: d.resortId })),
    ticketValues,
    seasonBudget: prefs.budget.seasonBudgetMinor != null ? money(prefs.budget.seasonBudgetMinor, prefs.budget.currency) : null,
    today,
  })

  const budgetNotes: string[] = []
  if (ideas) budgetNotes.push(`${ideas} trip idea${ideas === 1 ? ' is' : 's are'} not counted as planned spending.`)
  if (unpriced) budgetNotes.push(`${unpriced} planned trip item${unpriced === 1 ? ' has' : 's have'} no cost yet — the planned total is partial.`)
  if (dayLogSpend.length) {
    budgetNotes.push(`Spend noted on ski-day logs (${dayLogSpend.map((m) => formatMoney(m)).join(', ')}) is not added to the budget — record costs as expenses to count them.`)
  }
  // A priced lift ticket planned on a day my pass covers is real cash only if I buy a ticket anyway: flag it.
  const rulesBy = groupBy(pass.rules, (r) => r.productId)
  for (const i of tripItems) {
    if (normalizeCategory(i.type) !== 'lift' || i.costMinor == null || !i.refId || !i.date || !atResortInSeason(i.refId, i.date) || i.status === 'idea') continue
    const d = i.details ?? {}
    if (d.passCovered === true || typeof d.passOwnershipId === 'number') continue
    const covering = mine.find((o) =>
      evaluateAccess({
        product: o.product,
        rule: latestRule(rulesBy.get(o.product.id) ?? [], o.product.id, i.refId!),
        resortId: i.refId!,
        date: i.date!,
        usage: o.usage,
        poolRules: rulesBy.get(o.product.id) ?? [],
        today,
        seasonOf,
      }).canSki,
    )
    if (covering) budgetNotes.push(`"${i.title}" (${i.date}, ${name(i.refId)}) is a planned lift ticket on a day your ${covering.product.name} covers — remove it if you will use the pass.`)
  }
  budgetNotes.push('A pass purchase is counted once; days skied on the pass add no lift cost.')

  // --- Passes ----------------------------------------------------------------------------------------------------
  const famName = new Map(pass.families.map((f) => [f.id, f.name]))
  const shortNames = Object.fromEntries(resorts.map((r) => [r.id, r.shortName || r.name]))
  const seasonPasses: SeasonPassView[] = [...pass.owned]
    .sort((a, b) => Number(b.ownership.holder === 'me') - Number(a.ownership.holder === 'me') || a.ownership.id - b.ownership.id)
    .map((o) => ({
      ...ownedPassView(o, pass.rules, shortNames, famName.get(o.product.familyId) ?? o.product.familyId, seasonOf),
      value: o.ownership.holder === 'me' ? (budget.passes.find((p) => p.ownershipId === o.ownership.id) ?? null) : null,
    }))

  // --- Skills and lessons ----------------------------------------------------------------------------------------
  const seasonLessons = lessonRows.filter((l) => !l.date || atResortInSeason(l.resortId, l.date))
  const skillViews: SkillView[] = [...skills]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((k) => {
      const practiced = seasonLogs.filter((d) => d.skillsPracticed.includes(k.id)).map((d) => d.date).sort()
      return {
        id: k.id,
        label: k.label,
        category: k.category,
        status: k.status,
        statusLabel: SKILL_STATUS_LABEL[k.status],
        confirmedOn: k.confirmedOn,
        notes: k.notes,
        practicedDays: new Set(practiced).size,
        lastPracticed: practiced[practiced.length - 1] ?? null,
        lessons: seasonLessons.filter((l) => l.focusSkills.includes(k.id)).length,
      }
    })
  const groups = SKILL_ORDER.map((status) => ({ status, label: SKILL_STATUS_LABEL[status], skills: skillViews.filter((k) => k.status === status) })).filter((g) => g.skills.length)

  const lessonView = (l: LessonRow): LessonView => ({
    id: l.id,
    date: l.date,
    resortId: l.resortId,
    resortName: name(l.resortId),
    tripId: l.tripId,
    tripName: l.tripId ? (tripName.get(l.tripId) ?? null) : null,
    kind: l.kind,
    instructor: l.instructor,
    focusSkills: skillRefs(l.focusSkills),
    bookingRef: l.bookingRef,
    bookingUrl: l.bookingUrl,
    cost: l.costMinor != null && l.currency ? money(l.costMinor, l.currency) : null,
    costKind: l.costKind,
    notes: l.notes,
  })
  const dated = seasonLessons.filter((l) => l.date)
  const lessons = {
    upcoming: dated.filter((l) => l.date! >= today).sort((a, b) => a.date!.localeCompare(b.date!) || a.id - b.id).map(lessonView),
    past: dated.filter((l) => l.date! < today).sort((a, b) => b.date!.localeCompare(a.date!) || b.id - a.id).map(lessonView),
    undated: seasonLessons.filter((l) => !l.date).sort((a, b) => a.id - b.id).map(lessonView),
  }

  return {
    season: { id: seasonId, label: seasonLabel(seasonId) },
    today,
    skiDays,
    totals: {
      skiDays: skiDates.size,
      loggedDays: seasonLogs.length,
      resorts: destinations.length,
      hoursSkied: withHours.length ? Math.round(withHours.reduce((a, d) => a + d.hoursSkied!, 0) * 10) / 10 : null,
      daysWithHours: withHours.length,
      verticalM: withVertical.length ? Math.round(withVertical.reduce((a, d) => a + d.verticalM!, 0) * 10) / 10 : null,
      daysWithVertical: withVertical.length,
      dayLogSpend,
    },
    destinations,
    budget,
    budgetNotes,
    passes: seasonPasses,
    skills: {
      groups,
      total: skillViews.length,
      practicing: skillViews.filter((k) => k.status === 'practicing').length,
      confirmed: skillViews.filter((k) => k.status === 'self-confirmed' || k.status === 'instructor-confirmed').length,
      note: 'Progress is self-reported or instructor-confirmed. Piste never infers ability from spending or distance travelled.',
    },
    lessons,
    demo: !live,
  }
}
