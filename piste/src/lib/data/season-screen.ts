/**
 * My Season screen loader (/season). Builds on the season read model (getSeasonView: ski days, destinations, the
 * season budget, passes, skills, lessons) with what the editors and the overview need:
 *
 * - pickers: every resort (favourites first), non-cancelled trips, my passes for the active season;
 * - the skills checklist in its own order (the read model groups skills by status);
 * - which logged days already have a personal surface report for that resort and date;
 * - the season's expenses (the budget's "actual") — pass purchases linked to a pass are marked and left to Passes;
 * - the season timeline: logged days, pass-only days, lessons and planned trips on one date axis.
 *
 * Nothing here invents values: unknown stays null, and demo rows only ever come from the demo database.
 */
import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import * as s from '@/lib/db/schema'
import type { TripRow } from '@/lib/db/rows'
import { money, type Money } from '@/lib/domain/money'
import { addDays, isLocalDate, localDateOf, seasonIdFor } from '@/lib/domain/time'
import { getSeasonView, type SeasonView } from './season'
import { loadResortRows, type DataCtx } from './core'

export interface PickerResort {
  id: string
  name: string
  shortName: string
  region: string | null
  favorite: boolean
  /** Resort-local "today": a day can only be logged once it has started at the resort. */
  today: string
}

export interface PickerTrip {
  id: string
  name: string
  startDate: string
  endDate: string
  status: TripRow['status']
}

export interface ChecklistSkill {
  id: number
  label: string
  category: string | null
  sortOrder: number
  status: SeasonView['skills']['groups'][number]['status']
  confirmedOn: string | null
  notes: string | null
  practicedDays: number
  lastPracticed: string | null
  lessons: number
}

export interface ExpenseItem {
  id: number
  date: string
  category: string
  label: string
  amount: Money
  tripId: string | null
  tripName: string | null
  notes: string | null
  /** A pass purchase linked to a pass record: counted once, managed in Passes. */
  passOwnershipId: number | null
  passName: string | null
}

export interface PassOption {
  ownershipId: number
  productName: string
  familyId: string
  seasonId: string
}

export type TimelineMark =
  | { kind: 'day'; date: string; resortId: string; label: string; pass: boolean; logId: number | null; rating: number | null }
  | { kind: 'lesson'; date: string; resortId: string; label: string; upcoming: boolean }

export interface TimelineTrip {
  id: string
  name: string
  startDate: string
  endDate: string
  status: TripRow['status']
}

export interface SeasonTimeline {
  from: string
  to: string
  today: string
  marks: TimelineMark[]
  trips: TimelineTrip[]
}

export interface SeasonScreen {
  view: SeasonView
  mode: DataCtx['mode']
  today: string
  currency: string
  home: { name: string; lat: number; lon: number }
  resorts: PickerResort[]
  trips: PickerTrip[]
  passOptions: PassOption[]
  skills: ChecklistSkill[]
  skillCategories: string[]
  /** `${resortId}|${date}` keys that already have a personal surface report. */
  personalReports: string[]
  expenses: ExpenseItem[]
  timeline: SeasonTimeline
}

/** Season window drawn by the timeline: 1 Nov → 30 Apr, widened to include anything logged or planned outside it. */
export function timelineWindow(seasonId: string, dates: readonly string[]): { from: string; to: string } {
  const y = Number(seasonId.slice(0, 4))
  let from = `${y}-11-01`
  let to = `${y + 1}-04-30`
  for (const d of dates) {
    if (!isLocalDate(d) || seasonIdFor(d) !== seasonId) continue
    if (d < from) from = `${d.slice(0, 7)}-01`
    if (d > to) to = addDays(`${addDays(`${d.slice(0, 7)}-01`, 32).slice(0, 7)}-01`, -1)
  }
  return { from, to }
}

export async function getSeasonScreen(ctx: DataCtx): Promise<SeasonScreen> {
  const { db, now, today, prefs } = ctx
  const seasonId = prefs.activeSeasonId
  const inSeason = (d: string | null | undefined) => !!d && isLocalDate(d) && seasonIdFor(d) === seasonId

  const [view, resortRows, favs, trips, skillRows, expenseRows, personal, owned] = await Promise.all([
    getSeasonView(ctx),
    loadResortRows(ctx, null),
    db.select({ resortId: s.favorites.resortId }).from(s.favorites),
    db.select().from(s.trips).where(ne(s.trips.status, 'cancelled')),
    db.select().from(s.skillChecklist),
    db.select().from(s.expenses),
    db
      .select({ resortId: s.operationalReports.resortId, localDate: s.operationalReports.localDate })
      .from(s.operationalReports)
      .where(and(eq(s.operationalReports.kind, 'manual'), sql`coalesce(json_extract(${s.operationalReports.prov}, '$.note'), '') = 'personal'`)),
    db
      .select({ id: s.passOwnership.id, holder: s.passOwnership.holder, productId: s.passOwnership.productId, name: s.passProducts.name, familyId: s.passProducts.familyId, seasonId: s.passProducts.seasonId })
      .from(s.passOwnership)
      .innerJoin(s.passProducts, eq(s.passProducts.id, s.passOwnership.productId)),
  ])

  const favSet = new Set(favs.map((f) => f.resortId))
  const resorts: PickerResort[] = resortRows
    .map((r) => ({ id: r.id, name: r.name, shortName: r.shortName || r.name, region: r.region ?? null, favorite: favSet.has(r.id), today: localDateOf(now, r.timezone) }))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))

  const tripName = new Map(trips.map((t) => [t.id, t.name]))
  const pickerTrips: PickerTrip[] = trips
    .filter((t) => inSeason(t.startDate) || inSeason(t.endDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))
    .map((t) => ({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, status: t.status }))

  const mine = owned.filter((o) => o.holder === 'me')
  const passOptions: PassOption[] = mine.filter((o) => o.seasonId === seasonId).map((o) => ({ ownershipId: o.id, productName: o.name, familyId: o.familyId, seasonId: o.seasonId }))
  const passName = new Map(owned.map((o) => [o.id, o.name]))
  const minePass = new Set(passOptions.map((p) => p.ownershipId))

  // Skills in checklist order, with the read model's practice counts.
  const skillView = new Map(view.skills.groups.flatMap((g) => g.skills).map((k) => [k.id, k]))
  const skills: ChecklistSkill[] = [...skillRows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((k) => {
      const v = skillView.get(k.id)
      return {
        id: k.id,
        label: k.label,
        category: k.category,
        sortOrder: k.sortOrder,
        status: k.status,
        confirmedOn: k.confirmedOn,
        notes: k.notes,
        practicedDays: v?.practicedDays ?? 0,
        lastPracticed: v?.lastPracticed ?? null,
        lessons: v?.lessons ?? 0,
      }
    })
  const skillCategories = [...new Set(skills.map((k) => k.category).filter((c): c is string => !!c))]

  // Expenses in the season, plus the linked purchase of this season's passes (bought in the spring sale).
  const expenses: ExpenseItem[] = expenseRows
    .filter((e) => inSeason(e.date) || (e.passOwnershipId != null && minePass.has(e.passOwnershipId)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      label: e.label,
      amount: money(e.amountMinor, e.currency),
      tripId: e.tripId,
      tripName: e.tripId ? (tripName.get(e.tripId) ?? null) : null,
      notes: e.notes,
      passOwnershipId: e.passOwnershipId,
      passName: e.passOwnershipId != null ? (passName.get(e.passOwnershipId) ?? null) : null,
    }))

  // Timeline: every logged day, pass days without a journal entry, dated lessons and this season's trips.
  const name = new Map(resortRows.map((r) => [r.id, r.shortName || r.name]))
  const logged = new Set(view.skiDays.map((d) => `${d.resortId}|${d.date}`))
  const marks: TimelineMark[] = [
    ...view.skiDays.map((d) => ({ kind: 'day' as const, date: d.date, resortId: d.resortId, label: name.get(d.resortId) ?? d.resortName, pass: !!d.passDay, logId: d.id, rating: d.rating })),
    ...view.passes
      .filter((p) => p.holder === 'me')
      .flatMap((p) => p.usage.filter((u) => u.inSeason && !logged.has(`${u.resortId}|${u.date}`)))
      .map((u) => ({ kind: 'day' as const, date: u.date, resortId: u.resortId, label: name.get(u.resortId) ?? u.resortName, pass: true, logId: null, rating: null })),
    ...[...view.lessons.upcoming, ...view.lessons.past]
      .filter((l) => l.date)
      .map((l) => ({ kind: 'lesson' as const, date: l.date!, resortId: l.resortId, label: name.get(l.resortId) ?? l.resortName, upcoming: l.date! >= today })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const timelineTrips: TimelineTrip[] = pickerTrips.map((t) => ({ ...t }))
  const win = timelineWindow(seasonId, [...marks.map((m) => m.date), ...timelineTrips.flatMap((t) => [t.startDate, t.endDate])])

  return {
    view,
    mode: ctx.mode,
    today,
    currency: prefs.currency,
    home: { name: prefs.homeName, lat: prefs.homeLat, lon: prefs.homeLon },
    resorts,
    trips: pickerTrips,
    passOptions,
    skills,
    skillCategories,
    personalReports: [...new Set(personal.filter((p) => inSeason(p.localDate)).map((p) => `${p.resortId}|${p.localDate}`))],
    expenses,
    timeline: { from: win.from, to: win.to, today, marks, trips: timelineTrips },
  }
}
