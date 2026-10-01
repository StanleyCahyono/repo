/** Reads personal records from a database for export (server-side). */
import { eq, inArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import * as s from '@/lib/db/schema'
import type { EventRow, OperationalReportRow, TripItemRow, TripRow } from '@/lib/db/rows'
import type { AppMode } from '@/lib/domain/types'
import { PERSONAL_TABLES, type PersonalData, type PersonalTable } from './json'

type Rows = Record<string, unknown>[]

/** Manual entries: transcribed / personal reports and official reports I entered myself. */
function isUserReport(r: OperationalReportRow): boolean {
  if (r.kind === 'manual') return true
  return r.kind === 'official' && r.prov?.verification === 'user-confirmed'
}

const LOADERS: Record<PersonalTable, (db: Db, mode: AppMode) => Promise<Rows>> = {
  preferences: (db) => db.select().from(s.userPreferences),
  favorites: (db) => db.select().from(s.favorites).orderBy(s.favorites.sortOrder),
  ratings: (db) => db.select().from(s.myRatings),
  'pass-ownership': (db) => db.select().from(s.passOwnership),
  'pass-usage': (db) => db.select().from(s.passUsage).orderBy(s.passUsage.date),
  trips: (db) => db.select().from(s.trips).orderBy(s.trips.startDate),
  'trip-items': (db) => db.select().from(s.tripItems).orderBy(s.tripItems.tripId, s.tripItems.sortOrder, s.tripItems.id),
  'trip-checklist': (db) => db.select().from(s.tripChecklist).orderBy(s.tripChecklist.tripId, s.tripChecklist.sortOrder),
  'checklist-templates': (db) => db.select().from(s.checklistTemplates).orderBy(s.checklistTemplates.sortOrder),
  'ski-logs': (db) => db.select().from(s.skiDayLogs).orderBy(s.skiDayLogs.date),
  skills: (db) => db.select().from(s.skillChecklist).orderBy(s.skillChecklist.sortOrder),
  lessons: (db) => db.select().from(s.lessons),
  expenses: (db) => db.select().from(s.expenses).orderBy(s.expenses.date),
  'alert-rules': (db) => db.select().from(s.alertRules),
  'manual-reports': async (db, mode) => {
    const rows = await db.select().from(s.operationalReports).where(inArray(s.operationalReports.kind, ['manual', 'official', 'demo']))
    // Demo rows never leave the demo database; in live mode nothing of kind 'demo' is exported.
    return rows.filter((r) => (r.kind === 'demo' ? mode === 'demo' : isUserReport(r)))
  },
  'resort-overrides': (db) => db.select().from(s.resortOverrides),
  'my-resorts': (db) => db.select().from(s.resorts).where(eq(s.resorts.origin, 'user')),
  'my-hotels': (db) => db.select().from(s.hotels).where(eq(s.hotels.origin, 'user')),
  'my-events': (db) => db.select().from(s.events).where(eq(s.events.origin, 'user')),
  'price-estimates': (db) => db.select().from(s.priceSnapshots).where(eq(s.priceSnapshots.quoteKind, 'user-estimate')),
}

export async function collectTable(db: Db, table: PersonalTable, mode: AppMode): Promise<Rows> {
  return LOADERS[table](db, mode)
}

export async function collectPersonalData(db: Db, mode: AppMode): Promise<PersonalData> {
  const out = {} as PersonalData
  for (const t of PERSONAL_TABLES) out[t] = await collectTable(db, t, mode)
  return out
}

export async function loadTripForIcs(db: Db, tripId: string): Promise<{ trip: TripRow; items: TripItemRow[]; events: EventRow[] } | null> {
  const trip = (await db.select().from(s.trips).where(eq(s.trips.id, tripId)))[0]
  if (!trip) return null
  const items = await db.select().from(s.tripItems).where(eq(s.tripItems.tripId, tripId))
  const eventIds = items.filter((i) => i.type === 'event' && i.refId).map((i) => i.refId!)
  const events = eventIds.length ? await db.select().from(s.events).where(inArray(s.events.id, eventIds)) : []
  return { trip, items, events }
}

export async function loadEventForIcs(db: Db, eventId: string): Promise<EventRow | null> {
  return (await db.select().from(s.events).where(eq(s.events.id, eventId)))[0] ?? null
}
