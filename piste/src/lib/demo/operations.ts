/**
 * Simulated operations for one resort, replayed in time order through the same helpers live ingestion uses
 * (src/lib/jobs/status.ts and reports.ts), so the demo database has the shape live data would have:
 * - announcements → updateSeasonDates (every change logged to opening_date_history);
 * - official-style statements and daily reports → recordStatus (appended only when the status changes, stamped
 *   with statementTime) and applyStatusToSeason (the first open report confirms the actual opening);
 * - the daily status derivation (deriveSeasonStatus / derivedStatusTime) — an announced date that passes without
 *   an opening becomes "Status unavailable", never "Open".
 * Every simulated row carries demo provenance ('Piste demo generator', note 'Simulated…'); Piste's own derived
 * statements carry kind 'demo' with provider 'Piste', exactly as the status job writes them in the demo database.
 *
 * Speed: report rows are bulk-inserted first (they do not depend on the status history), and a helper call is
 * skipped only when the helper's own early-return condition holds (same status as the latest event; actual
 * opening already on or before the date), so every write still goes through the helpers.
 */
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { operationalReports, resortSeasons } from '@/lib/db/schema'
import type { OperationalReportRow, ResortRow, ResortSeasonRow, StatusEventRow } from '@/lib/db/rows'
import { dateRange, formatLocalDate, localTimeToInstant } from '@/lib/domain/time'
import { provenance, type OperatingStatus, type Provenance } from '@/lib/domain/types'
import { normalizeReport, reportContentHash, statementTime } from '@/lib/jobs/reports'
import { applyStatusToSeason, deriveSeasonStatus, derivedStatusTime, recordStatus, updateSeasonDates } from '@/lib/jobs/status'
import { bulkInsert } from './bulk'
import { simulatedTotalsText, type SimReport, type TerrainTotals } from './reports'
import { DEMO_PROVIDER, DEMO_TODAY, SEASON_ID, TRACKING_START, demoProv, type DemoResortProfile } from './scenario'

export interface OperationsResult {
  seasonVersions: { at: string; row: ResortSeasonRow }[]
  events: StatusEventRow[]
  reports: OperationalReportRow[]
}

type Action =
  | { at: string; order: number; kind: 'announce'; date: string; on: string; text: string }
  | { at: string; order: number; kind: 'statement'; status: OperatingStatus; localDate: string; note: string }
  | { at: string; order: number; kind: 'report'; row: OperationalReportRow }
  | { at: string; order: number; kind: 'derive'; date: string }

const plusMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString()

async function readSeason(db: Db, resortId: string): Promise<ResortSeasonRow | null> {
  const rows = await db
    .select()
    .from(resortSeasons)
    .where(and(eq(resortSeasons.resortId, resortId), eq(resortSeasons.seasonId, SEASON_ID)))
  return rows[0] ?? null
}

/** Insert the simulated reports (normalised and hashed like ingested ones); rows come back in time order. */
async function insertReports(db: Db, resort: ResortRow, sims: readonly SimReport[], totals: TerrainTotals): Promise<OperationalReportRow[]> {
  const totalsText = simulatedTotalsText(totals)
  const detail = `snow report generated for the demo${totalsText ? `; ${totalsText.charAt(0).toLowerCase()}${totalsText.slice(1)}` : ''}`
  await bulkInsert(
    db,
    operationalReports,
    sims.map((sim) => {
      const n = normalizeReport(sim.report)
      const prov: Provenance = demoProv({ publishedAt: n.reportedAt, fetchedAt: sim.fetchedAt }, detail)
      return {
        resortId: resort.id,
        localDate: n.localDate,
        revision: sim.revision,
        kind: 'demo' as const,
        reportedAt: n.reportedAt,
        fetchedAt: sim.fetchedAt,
        status: n.status,
        snowfall: n.snowfall,
        baseDepthCm: n.baseDepthCm,
        baseDepthLocation: n.baseDepthLocation,
        summitDepthCm: n.summitDepthCm,
        surfaceTags: n.surfaceTags,
        surfaceText: n.surfaceText,
        groomingText: n.groomingText,
        groomedRuns: n.groomedRuns,
        snowmakingText: n.snowmakingText,
        openTrails: n.openTrails,
        totalTrails: n.totalTrails,
        openLifts: n.openLifts,
        totalLifts: n.totalLifts,
        openBeginnerTrails: n.openBeginnerTrails,
        totalBeginnerTrails: n.totalBeginnerTrails,
        openAcres: n.openAcres,
        notes: n.notes,
        contentHash: reportContentHash(n),
        prov,
        createdAt: sim.fetchedAt,
      }
    }),
  )
  return db.select().from(operationalReports).where(eq(operationalReports.resortId, resort.id)).orderBy(asc(operationalReports.id))
}

export async function simulateOperations(db: Db, resort: ResortRow, profile: DemoResortProfile, sims: readonly SimReport[], totals: TerrainTotals): Promise<OperationsResult> {
  const tz = resort.timezone
  const baseline = await readSeason(db, resort.id)
  const seasonVersions: OperationsResult['seasonVersions'] = baseline ? [{ at: '', row: baseline }] : []
  const season = () => seasonVersions[seasonVersions.length - 1]?.row ?? null
  const events: StatusEventRow[] = []
  const snapshot = async (at: string) => {
    const row = await readSeason(db, resort.id)
    if (row) seasonVersions.push({ at, row })
  }
  const latestEvent = () => events[events.length - 1] ?? null
  const record = async (a: Parameters<typeof recordStatus>[1]) => {
    const latest = latestEvent()
    // recordStatus's own early returns: an older statement, or the same status as the latest event.
    if (latest && (latest.effectiveAt > a.effectiveAt || latest.status === a.status)) return
    const res = await recordStatus(db, a)
    if (res.appended && res.event) events.push(res.event)
  }
  const confirmOpening = async (status: OperatingStatus, localDate: string, prov: Provenance, now: string) => {
    const s = season()
    // applyStatusToSeason's own early returns: nothing to confirm unless this is the first open date (or a closure).
    const opens = (status === 'open' || status === 'partially-open') && !(s?.actualOpening && s.actualOpening <= localDate)
    const closes = status === 'closed-for-season' && !!s?.actualOpening && s.actualOpening <= localDate && !s.actualClosing
    if (!opens && !closes) return
    const changed = await applyStatusToSeason(db, { resortId: resort.id, status, localDate, prov, now })
    if (changed.length) await snapshot(now)
  }

  const reports = await insertReports(db, resort, sims, totals)

  const actions: Action[] = []
  for (const a of profile.announcements ?? []) {
    actions.push({ at: localTimeToInstant(a.on, a.at, tz), order: 0, kind: 'announce', date: a.date, on: a.on, text: a.text })
  }
  // Resorts not yet open at the tracking start say so on the first morning.
  if (!profile.opening || profile.opening > TRACKING_START) {
    actions.push({
      at: localTimeToInstant(TRACKING_START, '06:45', tz),
      order: 1,
      kind: 'statement',
      status: 'not-yet-open',
      localDate: TRACKING_START,
      note: 'Not open yet for the 2026–27 season — preparing for opening day.',
    })
  }
  for (const st of profile.statements ?? []) {
    actions.push({ at: localTimeToInstant(st.on, st.at, tz), order: 1, kind: 'statement', status: st.status, localDate: st.on, note: st.note })
  }
  for (const row of reports) actions.push({ at: row.reportedAt ?? row.createdAt, order: 2, kind: 'report', row })
  // The status job derives statuses from season dates; only announced dates can change anything here.
  if (profile.announcements?.length) {
    for (const date of dateRange(TRACKING_START, DEMO_TODAY)) actions.push({ at: localTimeToInstant(date, '07:00', tz), order: 3, kind: 'derive', date })
  }
  actions.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)

  let openingRecorded = !!baseline?.actualOpening
  for (const act of actions) {
    if (act.kind === 'announce') {
      const now = plusMinutes(act.at, 20)
      const prov = demoProv({ publishedAt: act.at, fetchedAt: now }, 'announced opening (a target, subject to weather and operations)')
      await updateSeasonDates(db, { resortId: resort.id, seasonId: SEASON_ID, changes: { announcedOpening: act.date }, prov, now })
      await db
        .update(resortSeasons)
        .set({ announcedOpeningText: act.text, announcedOpeningOn: act.on, lastCheckedAt: now, updatedAt: now })
        .where(and(eq(resortSeasons.resortId, resort.id), eq(resortSeasons.seasonId, SEASON_ID)))
      await snapshot(now)
    } else if (act.kind === 'statement') {
      const fetchedAt = plusMinutes(act.at, 15)
      await record({
        resortId: resort.id,
        status: act.status,
        localDate: act.localDate,
        effectiveAt: statementTime(act.at, fetchedAt),
        prov: demoProv({ publishedAt: act.at, fetchedAt }, 'operating status statement'),
        note: act.note,
      })
    } else if (act.kind === 'report') {
      const { row } = act
      const fetchedAt = row.fetchedAt ?? row.createdAt
      // A resort that opened before tracking began: its opening date is learned from the first report.
      if (!openingRecorded && profile.opening && profile.opening < TRACKING_START) {
        await updateSeasonDates(db, {
          resortId: resort.id,
          seasonId: SEASON_ID,
          changes: { actualOpening: profile.opening },
          prov: demoProv({ publishedAt: row.reportedAt, fetchedAt }, `opened ${formatLocalDate(profile.opening)}, before tracking began`),
          now: fetchedAt,
        })
        await snapshot(fetchedAt)
      }
      openingRecorded = true
      if (row.status && row.status !== 'unknown') {
        await record({
          resortId: resort.id,
          status: row.status,
          localDate: row.localDate,
          effectiveAt: statementTime(row.reportedAt, fetchedAt),
          prov: row.prov,
          note: `From ${DEMO_PROVIDER} (simulated report)`,
        })
        await confirmOpening(row.status, row.localDate, row.prov, fetchedAt)
      }
    } else {
      const latest = latestEvent()
      const derived = deriveSeasonStatus(season(), act.date, latest)
      if (!derived || latest?.status === derived.status) continue
      await record({
        resortId: resort.id,
        status: derived.status,
        localDate: act.date,
        effectiveAt: derivedStatusTime(act.date, tz, act.at, latest),
        note: derived.note,
        prov: provenance({ kind: 'demo', provider: 'Piste', fetchedAt: act.at, season: SEASON_ID, note: derived.note }),
      })
    }
  }
  events.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id - b.id)
  return { seasonVersions, events, reports }
}
