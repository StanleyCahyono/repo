/**
 * Operating status history and season dates.
 *
 * - Status events are appended only when the status changes — never overwritten, never reordered: a statement
 *   older than the latest recorded one is not appended.
 * - An announced opening date is a target. Reaching it never produces 'open'; once it passes without an official
 *   confirmation the derived status becomes 'unknown' ("Status unavailable").
 * - Every change to announced/actual opening or closing dates is logged to opening_date_history.
 */
import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { openingDateHistory, resortSeasons, seasons, statusEvents } from '@/lib/db/schema'
import type { ResortSeasonRow, StatusEventRow } from '@/lib/db/rows'
import { localDateOf, seasonIdFor, formatLocalDate, startOfLocalDay } from '@/lib/domain/time'
import { provenance, type OperatingStatus, type Provenance } from '@/lib/domain/types'
import type { ItemOutcome, JobContext, JobWorkResult } from './types'
import { errorMessage, selectResorts } from './util'

export async function latestStatusEvent(db: Db, resortId: string): Promise<StatusEventRow | null> {
  const rows = await db
    .select()
    .from(statusEvents)
    .where(eq(statusEvents.resortId, resortId))
    .orderBy(desc(statusEvents.effectiveAt), desc(statusEvents.id))
    .limit(1)
  return rows[0] ?? null
}

export interface RecordStatusArgs {
  resortId: string
  status: OperatingStatus
  /** Resort-local date the statement applies to. */
  localDate: string
  /** When the source made the statement (report time), else when it was fetched. */
  effectiveAt: string
  prov: Provenance
  note?: string | null
}

/** Append a status event if (and only if) the status changed. */
export async function recordStatus(db: Db, a: RecordStatusArgs): Promise<{ appended: boolean; event: StatusEventRow | null }> {
  const latest = await latestStatusEvent(db, a.resortId)
  if (latest && latest.effectiveAt > a.effectiveAt) return { appended: false, event: latest }
  if (latest && latest.status === a.status) return { appended: false, event: latest }
  const [row] = await db
    .insert(statusEvents)
    .values({ resortId: a.resortId, status: a.status, effectiveAt: a.effectiveAt, localDate: a.localDate, note: a.note ?? null, prov: a.prov })
    .returning()
  return { appended: true, event: row }
}

// ---------------------------------------------------------------------------
// Season dates

export type SeasonDateField = 'announcedOpening' | 'actualOpening' | 'announcedClosing' | 'actualClosing'

const PROV_FIELD = {
  announcedOpening: 'announcedOpeningProv',
  actualOpening: 'actualOpeningProv',
  announcedClosing: 'announcedClosingProv',
  actualClosing: 'actualClosingProv',
} as const

/** Seasons run 1 Jul → 30 Jun (see seasonIdFor); create the season row a resort season refers to. */
async function ensureSeason(db: Db, seasonId: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(seasonId)
  if (!m) throw new Error(`Invalid season id: ${seasonId}`)
  const start = Number(m[1])
  await db
    .insert(seasons)
    .values({ id: seasonId, label: `${start}–${String(start + 1).slice(2)}`, startDate: `${start}-07-01`, endDate: `${start + 1}-06-30` })
    .onConflictDoNothing()
}

/** Update season dates, logging each change to opening_date_history. Returns the fields that changed. */
export async function updateSeasonDates(
  db: Db,
  a: { resortId: string; seasonId: string; changes: Partial<Record<SeasonDateField, string | null>>; prov: Provenance; now: string },
): Promise<SeasonDateField[]> {
  const existing = (
    await db
      .select()
      .from(resortSeasons)
      .where(and(eq(resortSeasons.resortId, a.resortId), eq(resortSeasons.seasonId, a.seasonId)))
  )[0]
  const changed: SeasonDateField[] = []
  const set: Partial<typeof resortSeasons.$inferInsert> = {}
  for (const field of Object.keys(a.changes) as SeasonDateField[]) {
    const next = a.changes[field] ?? null
    const prev = existing ? existing[field] : null
    if (prev === next) continue
    changed.push(field)
    set[field] = next
    set[PROV_FIELD[field]] = next === null ? null : a.prov
    await db.insert(openingDateHistory).values({
      resortId: a.resortId,
      seasonId: a.seasonId,
      field,
      previousValue: prev,
      newValue: next,
      changedAt: a.now,
      prov: a.prov,
    })
  }
  if (changed.length === 0) return changed
  if (existing) {
    await db
      .update(resortSeasons)
      .set({ ...set, updatedAt: a.now })
      .where(eq(resortSeasons.id, existing.id))
  } else {
    await ensureSeason(db, a.seasonId)
    await db.insert(resortSeasons).values({ resortId: a.resortId, seasonId: a.seasonId, ...set, updatedAt: a.now })
  }
  return changed
}

/**
 * Season facts implied by an official (or transcribed-official) status statement: 'open'/'partially-open' confirms
 * the actual opening; 'closed-for-season' after an opening confirms the actual closing.
 */
export async function applyStatusToSeason(
  db: Db,
  a: { resortId: string; status: OperatingStatus; localDate: string; prov: Provenance; now: string },
): Promise<SeasonDateField[]> {
  const seasonId = seasonIdFor(a.localDate)
  const season = (
    await db
      .select()
      .from(resortSeasons)
      .where(and(eq(resortSeasons.resortId, a.resortId), eq(resortSeasons.seasonId, seasonId)))
  )[0]
  if (a.status === 'open' || a.status === 'partially-open') {
    if (season?.actualOpening && season.actualOpening <= a.localDate) return []
    return updateSeasonDates(db, { resortId: a.resortId, seasonId, changes: { actualOpening: a.localDate }, prov: a.prov, now: a.now })
  }
  if (a.status === 'closed-for-season' && season?.actualOpening && season.actualOpening <= a.localDate && !season.actualClosing) {
    return updateSeasonDates(db, { resortId: a.resortId, seasonId, changes: { actualClosing: a.localDate }, prov: a.prov, now: a.now })
  }
  return []
}

// ---------------------------------------------------------------------------
// Derived statuses

export interface DerivedStatus {
  status: OperatingStatus
  note: string
}

type SeasonDates = Pick<ResortSeasonRow, 'announcedOpening' | 'actualOpening' | 'actualClosing'>

/**
 * Status implied by season dates alone (pure). Never 'open': operations come from official statements.
 * `latest` is the latest recorded event; derived statuses never override a newer official statement of this season.
 */
export function deriveSeasonStatus(season: SeasonDates | null, today: string, latest: Pick<StatusEventRow, 'status' | 'localDate' | 'prov'> | null): DerivedStatus | null {
  if (!season) return null
  // Piste's own statements (kind 'derived', or 'demo' ones written by Piste in the demo database) may be superseded,
  // and so may any statement about an earlier season: last April's "closed for the season" says nothing about
  // this October.
  const supersedable =
    !latest ||
    latest.prov.kind === 'derived' ||
    (latest.prov.kind === 'demo' && latest.prov.provider === 'Piste') ||
    seasonIdFor(latest.localDate) !== seasonIdFor(today)
  if (season.actualClosing && season.actualClosing <= today) {
    return supersedable || latest!.localDate < season.actualClosing
      ? { status: 'closed-for-season', note: `Closed for the season on ${formatLocalDate(season.actualClosing)}` }
      : null
  }
  if (season.actualOpening && season.actualOpening <= today) return null
  const announced = season.announcedOpening
  if (!announced) return null
  if (today < announced) {
    return supersedable ? { status: 'not-yet-open', note: `Announced opening ${formatLocalDate(announced)} is a target, not a confirmation` } : null
  }
  // The announced date has arrived without a confirmed opening: status is unknown, never "open".
  if (supersedable || latest!.localDate < announced) {
    return { status: 'unknown', note: `Announced opening date (${formatLocalDate(announced)}) reached without an official confirmation` }
  }
  return null
}

/**
 * When a derived status for resort-local `today` takes effect. It describes the whole local day, so it is stamped
 * at the day's start: any official statement made later that day — even one fetched after this job ran — is newer
 * and wins. (Stamping it with the job's run time would let it out-rank, and so drop, an official statement
 * published earlier the same day but fetched later.) When the statement it supersedes was itself made later today
 * (e.g. yesterday's report first fetched this morning), it is stamped at that statement's time so it still lands
 * after it without moving the ordering threshold for anything else.
 */
export function derivedStatusTime(today: string, tz: string, now: string, latest: Pick<StatusEventRow, 'effectiveAt'> | null): string {
  const dayStart = startOfLocalDay(today, tz)
  return latest && latest.effectiveAt > dayStart && latest.effectiveAt <= now ? latest.effectiveAt : dayStart
}

/** Append derived statuses where season dates imply a change (hourly by default, and on manual refresh). */
export async function deriveStatuses(ctx: JobContext): Promise<JobWorkResult> {
  const { db, now } = ctx
  const resorts = await selectResorts(db, ctx.target ? [ctx.target] : null)
  const items: ItemOutcome[] = []
  for (const resort of resorts) {
    const key = resort.id
    try {
      const today = localDateOf(now, resort.timezone)
      const seasonId = seasonIdFor(today)
      const season =
        (
          await db
            .select()
            .from(resortSeasons)
            .where(and(eq(resortSeasons.resortId, resort.id), eq(resortSeasons.seasonId, seasonId)))
        )[0] ?? null
      const latest = await latestStatusEvent(db, resort.id)
      const derived = deriveSeasonStatus(season, today, latest)
      if (!derived || latest?.status === derived.status) {
        items.push({ key, target: resort.id, ok: true, skipped: true, written: 0 })
        continue
      }
      const res = await recordStatus(db, {
        resortId: resort.id,
        status: derived.status,
        localDate: today,
        effectiveAt: derivedStatusTime(today, resort.timezone, now, latest),
        note: derived.note,
        prov: provenance({ kind: ctx.deps.demo ? 'demo' : 'derived', provider: 'Piste', fetchedAt: now, season: seasonId, note: derived.note }),
      })
      items.push({ key, target: resort.id, ok: true, written: res.appended ? 1 : 0 })
    } catch (e) {
      items.push({ key, target: resort.id, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  return { items }
}
