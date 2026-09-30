/**
 * Official report ingestion, manual report entry and personal feedback reports.
 *
 * Change detection ("a fetched page doesn't mean a new report"):
 * - The content hash covers the normalised report WITHOUT `reportedAt` and `localDate`, so a page that re-renders
 *   its timestamp, or keeps showing yesterday's report after midnight, is not a new report.
 * - If the hash equals the latest stored official report for the resort, nothing is inserted and that report's
 *   `reportedAt` / `fetchedAt` are left alone (its observation age keeps growing). The fetch is still logged in
 *   source_records.
 * - Otherwise a new revision is inserted: revision = 1 + the highest revision for that resort / local date / kind.
 * - A failed fetch or parse writes a source_records row with the error and parser errors; the last good report is
 *   kept.
 *
 * Kinds (all in operational_reports, told apart by `kind` + `prov`):
 * - adapter reports: kind 'official', prov.verification from the adapter.
 * - official-by-user: kind 'official', prov.verification 'user-confirmed', prov.note 'entered-by-user'.
 * - transcribed manual reports: kind 'manual', sourceUrl required, prov.note 'transcribed'.
 * - personal feedback: kind 'manual', prov.provider 'You', prov.note 'personal' — never used as operations evidence.
 * - researched: kind 'official', prov.verification from the catalog research ('search-summary'), prov.note
 *   'catalog-research' — a dated report found by web research (catalog `recentReports`), seeded with its own observation
 *   day and source (origin 'other': never "read by Piste", never live).
 */
import { and, desc, eq, max } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { operationalReports, sourceRecords } from '@/lib/db/schema'
import type { OperationalReportRow } from '@/lib/db/rows'
import { RESEARCHED_REPORT_NOTE, isResearchedReport } from '@/lib/domain/reports'
import { formatLocalDate, isLocalDate, localDateOf, localTimeToInstant } from '@/lib/domain/time'
import {
  OPERATING_STATUSES,
  SNOW_WINDOWS,
  SURFACE_TAGS,
  provenance,
  type DataKind,
  type OperatingStatus,
  type Provenance,
  type SnowfallReading,
  type VerificationLevel,
} from '@/lib/domain/types'
import type { ParsedReport, ProviderResult, ResortReportProvider } from '@/lib/providers/types'
import { applyStatusToSeason, recordStatus } from './status'
import { STOPPED_NOTE, type ItemOutcome, type JobContext, type JobWorkResult } from './types'
import { canonicalInstant, errorMessage, hashJson, minutesAfter, selectResorts, truncate } from './util'

export const PERSONAL_NOTE = 'personal'
export const TRANSCRIBED_NOTE = 'transcribed'
export const ENTERED_BY_USER_NOTE = 'entered-by-user'

export type ReportOrigin = 'official-adapter' | 'official-by-user' | 'manual-transcribed' | 'personal' | 'demo' | 'other'

/**
 * How a stored report came to exist — for badges and for keeping personal feedback out of operations evidence. A report
 * found by catalog research is 'other' (see `isResearchedReport` for its own label): it was neither read by Piste nor
 * entered by you.
 */
export function reportOrigin(r: Pick<OperationalReportRow, 'kind' | 'prov'>): ReportOrigin {
  if (r.kind === 'demo') return 'demo'
  if (r.kind === 'manual') return r.prov?.note === PERSONAL_NOTE ? 'personal' : 'manual-transcribed'
  if (r.kind === 'official') return r.prov?.note === ENTERED_BY_USER_NOTE ? 'official-by-user' : isResearchedReport(r) ? 'other' : 'official-adapter'
  return 'other'
}

export { RESEARCHED_REPORT_NOTE, isResearchedReport }

export function isPersonalReport(r: Pick<OperationalReportRow, 'kind' | 'prov'>): boolean {
  return reportOrigin(r) === 'personal'
}

// ---------------------------------------------------------------------------
// Normalisation & hashing

const round1 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const clean = (s: string | null) => {
  if (s === null) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** Canonical form: trimmed text, 0.1-rounded measurements, snowfall ordered by window, unique sorted tags. */
export function normalizeReport(r: ParsedReport): ParsedReport {
  const order = (w: string) => {
    const i = (SNOW_WINDOWS as readonly string[]).indexOf(w)
    return i === -1 ? 99 : i
  }
  const snowfall: SnowfallReading[] = [...r.snowfall]
    .map((s) => ({
      window: s.window,
      amountCm: round1(s.amountCm),
      startAt: s.startAt ? (canonicalInstant(s.startAt) ?? s.startAt) : null,
      endAt: s.endAt ? (canonicalInstant(s.endAt) ?? s.endAt) : null,
      sourceText: clean(s.sourceText ?? null),
    }))
    .sort((a, b) => order(a.window) - order(b.window) || (a.sourceText ?? '').localeCompare(b.sourceText ?? ''))
  return {
    localDate: r.localDate,
    reportedAt: r.reportedAt ? (canonicalInstant(r.reportedAt) ?? r.reportedAt) : null,
    status: r.status,
    snowfall,
    baseDepthCm: round1(r.baseDepthCm),
    baseDepthLocation: clean(r.baseDepthLocation),
    summitDepthCm: round1(r.summitDepthCm),
    surfaceTags: [...new Set(r.surfaceTags)].sort(),
    surfaceText: clean(r.surfaceText),
    groomingText: clean(r.groomingText),
    groomedRuns: r.groomedRuns,
    snowmakingText: clean(r.snowmakingText),
    openTrails: r.openTrails,
    totalTrails: r.totalTrails,
    openLifts: r.openLifts,
    totalLifts: r.totalLifts,
    openBeginnerTrails: r.openBeginnerTrails,
    totalBeginnerTrails: r.totalBeginnerTrails,
    openAcres: round1(r.openAcres),
    notes: clean(r.notes),
  }
}

/** Hash of the report content, excluding `reportedAt` and `localDate` (see module comment). */
export function reportContentHash(r: ParsedReport): string {
  const n = normalizeReport(r)
  const { reportedAt: _reportedAt, localDate: _localDate, ...content } = n
  return hashJson(content)
}

function reportRowValues(n: ParsedReport) {
  return {
    localDate: n.localDate,
    reportedAt: n.reportedAt,
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
  }
}

async function nextRevision(db: Db, resortId: string, localDate: string, kind: DataKind): Promise<number> {
  const r = await db
    .select({ m: max(operationalReports.revision) })
    .from(operationalReports)
    .where(and(eq(operationalReports.resortId, resortId), eq(operationalReports.localDate, localDate), eq(operationalReports.kind, kind)))
  return (r[0]?.m ?? 0) + 1
}

/** Latest stored adapter report for a resort (any date). */
export async function latestOfficialReport(db: Db, resortId: string): Promise<OperationalReportRow | null> {
  const rows = await db
    .select()
    .from(operationalReports)
    .where(and(eq(operationalReports.resortId, resortId), eq(operationalReports.kind, 'official')))
    .orderBy(desc(operationalReports.localDate), desc(operationalReports.revision), desc(operationalReports.id))
    .limit(20)
  return rows.find((r) => reportOrigin(r) === 'official-adapter') ?? null
}

/**
 * When a status statement takes effect in the status history: the source's own time, unless it is missing,
 * unparseable or later than `latestPossible` (when we retrieved or entered it). A statement cannot postdate its
 * retrieval; a future stamp (a typo, or a local "updated 06:00" parsed as UTC) would otherwise become the latest
 * status event and block every later change, closures included. The report row keeps the source's `reportedAt`.
 */
export function statementTime(reportedAt: string | null, latestPossible: string): string {
  const bound = canonicalInstant(latestPossible) ?? latestPossible
  const stated = reportedAt ? canonicalInstant(reportedAt) : null
  return stated && stated <= bound ? stated : bound
}

/** A manual report's `reportedAt` may run ahead of the app clock by at most this much (clock skew). */
export const MANUAL_REPORT_CLOCK_SKEW_MINUTES = 5

// ---------------------------------------------------------------------------
// Adapter ingestion

export interface IngestOutcome {
  outcome: 'inserted' | 'unchanged' | 'failed'
  reportId: number | null
  revision: number | null
  sourceRecordId: number
  statusAppended: boolean
  error: string | null
}

export async function ingestOfficialReport(
  db: Db,
  a: { provider: Pick<ResortReportProvider, 'id' | 'resortId' | 'label' | 'url' | 'maturity'>; result: ProviderResult<ParsedReport>; timezone: string; now: string },
): Promise<IngestOutcome> {
  const { provider, result, now } = a
  const last = result.fetches[result.fetches.length - 1]
  const base = {
    adapter: provider.id,
    adapterVersion: provider.maturity,
    resortId: provider.resortId,
    url: last?.url ?? provider.url,
    fetchedAt: last?.fetchedAt ?? now,
    httpStatus: last?.httpStatus ?? null,
  }

  if (!result.ok) {
    const parserErrors = result.errorKind === 'parse' || result.errorKind === 'schema-changed' ? [result.error] : null
    const error = truncate(`${result.errorKind}: ${result.error}`, 1000)
    const [sr] = await db
      .insert(sourceRecords)
      .values({ ...base, ok: false, contentHash: last?.contentHash ?? null, extract: null, error, parserErrors })
      .returning({ id: sourceRecords.id })
    return { outcome: 'failed', reportId: null, revision: null, sourceRecordId: sr.id, statusAppended: false, error }
  }

  const n = normalizeReport(result.data)
  if (!isLocalDate(n.localDate)) {
    const error = `schema-changed: report localDate "${String(n.localDate)}" is not a YYYY-MM-DD date`
    const [sr] = await db
      .insert(sourceRecords)
      .values({ ...base, ok: false, contentHash: null, extract: null, error, parserErrors: [error] })
      .returning({ id: sourceRecords.id })
    return { outcome: 'failed', reportId: null, revision: null, sourceRecordId: sr.id, statusAppended: false, error }
  }
  const hash = reportContentHash(n)
  const extract = { report: n, fetches: result.fetches.map((f) => ({ url: f.url, httpStatus: f.httpStatus, contentHash: f.contentHash })) }
  const [sr] = await db
    .insert(sourceRecords)
    .values({ ...base, ok: true, contentHash: hash, extract, error: null, parserErrors: null })
    .returning({ id: sourceRecords.id })

  const latest = await latestOfficialReport(db, provider.resortId)
  if (latest && latest.contentHash === hash) {
    return { outcome: 'unchanged', reportId: latest.id, revision: latest.revision, sourceRecordId: sr.id, statusAppended: false, error: null }
  }

  const prov: Provenance = {
    ...provenance({ kind: 'official', provider: provider.label, sourceUrl: provider.url }),
    ...result.provenance,
    kind: 'official',
    publishedAt: n.reportedAt,
    fetchedAt: base.fetchedAt,
  }
  const revision = await nextRevision(db, provider.resortId, n.localDate, 'official')
  const [row] = await db
    .insert(operationalReports)
    .values({
      resortId: provider.resortId,
      revision,
      kind: 'official',
      fetchedAt: base.fetchedAt,
      contentHash: hash,
      prov,
      createdAt: now,
      ...reportRowValues(n),
    })
    .returning({ id: operationalReports.id })

  let statusAppended = false
  if (n.status && n.status !== 'unknown') {
    const res = await recordStatus(db, {
      resortId: provider.resortId,
      status: n.status,
      localDate: n.localDate,
      effectiveAt: statementTime(n.reportedAt, base.fetchedAt),
      prov,
      note: `From ${provider.label}`,
    })
    statusAppended = res.appended
    await applyStatusToSeason(db, { resortId: provider.resortId, status: n.status, localDate: n.localDate, prov, now })
  }
  return { outcome: 'inserted', reportId: row.id, revision, sourceRecordId: sr.id, statusAppended, error: null }
}

/** Run every official report adapter (or the one for `ctx.target`). */
export async function refreshReports(ctx: JobContext, opts: { resortIds?: readonly string[] | null } = {}): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: official reports are never fetched into demo data'] }
  const ids = opts.resortIds ?? (ctx.target ? [ctx.target] : null)
  const providers = deps.reportProviders.filter((p) => !ids || ids.includes(p.resortId))
  const resorts = new Map((await selectResorts(db, providers.map((p) => p.resortId))).map((r) => [r.id, r]))
  const items: ItemOutcome[] = []
  for (const provider of providers) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    const key = `${provider.resortId}:${provider.id}`
    const resort = resorts.get(provider.resortId)
    if (!resort) {
      items.push({ key, target: provider.resortId, ok: true, skipped: true, written: 0, error: 'Resort not in catalog' })
      continue
    }
    try {
      let result: ProviderResult<ParsedReport>
      try {
        result = await provider.fetchReport({ now, timezone: resort.timezone })
      } catch (e) {
        result = { ok: false, error: errorMessage(e), errorKind: 'network', retriable: true, fetches: [] }
      }
      const out = await ingestOfficialReport(db, { provider, result, timezone: resort.timezone, now })
      if (out.outcome === 'failed') items.push({ key, target: resort.id, ok: false, written: 0, error: out.error })
      else items.push({ key, target: resort.id, ok: true, written: out.outcome === 'inserted' ? 1 : 0 })
    } catch (e) {
      items.push({ key, target: resort.id, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  return { items }
}

// ---------------------------------------------------------------------------
// Manual entry (used by the UI)

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL')
const nullableNum = (maxV: number) => z.number().finite().min(0).max(maxV).nullable().default(null)
const nullableInt = z.number().int().min(0).max(10_000).nullable().default(null)
const nullableText = (maxLen: number) =>
  z
    .string()
    .max(maxLen)
    .nullable()
    .default(null)
    .transform((s) => (s === null ? null : s.trim() === '' ? null : s.trim()))

export const ManualReportInput = z.object({
  resortId: z.string().min(1).max(100),
  localDate: z.string().refine(isLocalDate, 'Expected YYYY-MM-DD'),
  /** 'manual' = typed from an official source; 'official' = an official report entered by me (verified by me). */
  kind: z.enum(['manual', 'official']).default('manual'),
  sourceUrl: httpUrl,
  sourceLabel: nullableText(120),
  reportedAt: z.string().nullable().default(null).refine((s) => s === null || canonicalInstant(s) !== null, 'Expected an ISO instant'),
  status: z.enum(OPERATING_STATUSES).nullable().default(null),
  snowfall: z
    .array(z.object({ window: z.enum(SNOW_WINDOWS), amountCm: nullableNum(1000), sourceText: nullableText(200) }))
    .max(10)
    .default([]),
  baseDepthCm: nullableNum(2000),
  baseDepthLocation: nullableText(120),
  summitDepthCm: nullableNum(2000),
  surfaceTags: z.array(z.enum(SURFACE_TAGS)).max(9).default([]),
  surfaceText: nullableText(1000),
  groomingText: nullableText(1000),
  groomedRuns: nullableInt,
  snowmakingText: nullableText(1000),
  openTrails: nullableInt,
  totalTrails: nullableInt,
  openLifts: nullableInt,
  totalLifts: nullableInt,
  openBeginnerTrails: nullableInt,
  totalBeginnerTrails: nullableInt,
  openAcres: nullableNum(100_000),
  notes: nullableText(2000),
})
export type ManualReportInput = z.input<typeof ManualReportInput>

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Insert a report typed from an official source (kind 'manual') or an official report entered by me.
 * A `reportedAt` later than now (beyond a few minutes of clock skew) is rejected: a statement from the future would
 * freeze the status history.
 */
export async function addManualReport(db: Db, input: ManualReportInput, now: string): Promise<{ id: number; revision: number; statusAppended: boolean }> {
  const latestAllowed = minutesAfter(now, MANUAL_REPORT_CLOCK_SKEW_MINUTES)
  const v = ManualReportInput.refine((x) => x.reportedAt === null || (canonicalInstant(x.reportedAt) ?? '') <= latestAllowed, {
    path: ['reportedAt'],
    message: 'Reported time cannot be in the future',
  }).parse(input)
  const host = v.sourceLabel ?? hostOf(v.sourceUrl)
  const prov: Provenance =
    v.kind === 'official'
      ? provenance({
          kind: 'official',
          provider: host,
          sourceUrl: v.sourceUrl,
          publishedAt: v.reportedAt,
          fetchedAt: now,
          verification: 'user-confirmed',
          note: ENTERED_BY_USER_NOTE,
        })
      : provenance({
          kind: 'manual',
          provider: `You (from ${host})`,
          sourceUrl: v.sourceUrl,
          publishedAt: v.reportedAt,
          fetchedAt: now,
          verification: 'user-confirmed',
          note: TRANSCRIBED_NOTE,
        })
  const parsed: ParsedReport = {
    ...v,
    reportedAt: v.reportedAt ? canonicalInstant(v.reportedAt) : null,
    snowfall: v.snowfall.map((s) => ({ window: s.window, amountCm: s.amountCm, sourceText: s.sourceText })),
  }
  const n = normalizeReport(parsed)
  const revision = await nextRevision(db, v.resortId, v.localDate, v.kind)
  const [row] = await db
    .insert(operationalReports)
    .values({ resortId: v.resortId, revision, kind: v.kind, fetchedAt: null, contentHash: reportContentHash(n), prov, createdAt: now, ...reportRowValues(n) })
    .returning({ id: operationalReports.id })
  let statusAppended = false
  if (n.status && n.status !== 'unknown') {
    const res = await recordStatus(db, {
      resortId: v.resortId,
      status: n.status,
      localDate: n.localDate,
      effectiveAt: statementTime(n.reportedAt, now),
      prov,
      note: `Entered from ${host}`,
    })
    statusAppended = res.appended
    await applyStatusToSeason(db, { resortId: v.resortId, status: n.status, localDate: n.localDate, prov, now })
  }
  return { id: row.id, revision, statusAppended }
}

export const PersonalReportInput = z.object({
  resortId: z.string().min(1).max(100),
  localDate: z.string().refine(isLocalDate, 'Expected YYYY-MM-DD'),
  surfaceTags: z.array(z.enum(SURFACE_TAGS)).max(9).default([]),
  surfaceText: nullableText(1000),
  notes: nullableText(2000),
})
export type PersonalReportInput = z.input<typeof PersonalReportInput>

/**
 * My own surface feedback. Stored as kind 'manual' with prov.note 'personal'; it never sets operating status,
 * season dates or terrain, and assessments read it as personal feedback, not as an operations report.
 */
export async function addPersonalReport(db: Db, input: PersonalReportInput, now: string): Promise<{ id: number; revision: number }> {
  const v = PersonalReportInput.parse(input)
  const parsed: ParsedReport = {
    localDate: v.localDate,
    reportedAt: now,
    status: null,
    snowfall: [],
    baseDepthCm: null,
    baseDepthLocation: null,
    summitDepthCm: null,
    surfaceTags: v.surfaceTags,
    surfaceText: v.surfaceText,
    groomingText: null,
    groomedRuns: null,
    snowmakingText: null,
    openTrails: null,
    totalTrails: null,
    openLifts: null,
    totalLifts: null,
    openBeginnerTrails: null,
    totalBeginnerTrails: null,
    openAcres: null,
    notes: v.notes,
  }
  const n = normalizeReport(parsed)
  const prov = provenance({ kind: 'manual', provider: 'You', sourceUrl: null, publishedAt: now, fetchedAt: now, verification: 'user-confirmed', note: PERSONAL_NOTE })
  const revision = await nextRevision(db, v.resortId, v.localDate, 'manual')
  const [row] = await db
    .insert(operationalReports)
    .values({ resortId: v.resortId, revision, kind: 'manual', fetchedAt: null, contentHash: reportContentHash(n), prov, createdAt: now, ...reportRowValues(n) })
    .returning({ id: operationalReports.id })
  return { id: row.id, revision }
}

// ---------------------------------------------------------------------------
// Reports found by catalog research (seeded from catalog `recentReports`)

export interface ResearchedReportInput {
  resortId: string
  /** The resort's IANA zone: `observedOn` is a resort-local day. */
  timezone: string
  observedOn: string
  operatingStatus: 'open' | 'closed' | 'closed-for-season' | 'not-yet-open' | null
  baseDepthCm: number | null
  summitDepthCm: number | null
  newSnow24hCm: number | null
  liftsOpen: number | null
  liftsTotal: number | null
  note: string | null
  source: { url: string | null; verification: VerificationLevel; checkedOn: string }
  /** Provider name of the research (the catalog's). */
  provider: string
}

export interface ResearchedReportOutcome {
  outcome: 'inserted' | 'unchanged' | 'skipped'
  reportId: number | null
  /** Why a report was skipped. */
  reason: string | null
}

/** A researched "closed" on a day is a closure of that day, not of the season. */
const RESEARCHED_STATUS: Record<NonNullable<ResearchedReportInput['operatingStatus']>, OperatingStatus> = {
  open: 'open',
  closed: 'temporarily-closed',
  'closed-for-season': 'closed-for-season',
  'not-yet-open': 'not-yet-open',
}

/** Research can read a page; it cannot claim an API or your confirmation. */
const researchVerification = (v: VerificationLevel): VerificationLevel => (v === 'official-page' || v === 'unverified' ? v : 'search-summary')

/**
 * Store a dated report found by catalog research as an official report of its own observation day (kind 'official',
 * prov.note 'catalog-research', the research's verification and source), with no publish time (`reportedAt` null — its
 * age runs from the start of that day) and retrieved when the research checked it (`fetchedAt`, never later than now).
 *
 * Idempotent: a report with the same content for the same resort and day is 'unchanged' — nothing is written, so a
 * re-seed never resets its observation age. Changed content for the same day is a new revision.
 *
 * Its status goes through the normal status pipeline (`recordStatus`: appended only when it changes, never before a
 * newer statement), stated at local noon of the observed day (bounded by when research checked it). Season facts come
 * from closures only (`applyStatusToSeason`): an "open" snapshot says the resort was open that day, not that it opened
 * that day, so it never becomes the season's actual opening.
 * Skipped: a day in the future at the resort, a day after the research date, or a report with nothing in it.
 */
export async function addResearchedReport(db: Db, a: ResearchedReportInput, now: string): Promise<ResearchedReportOutcome> {
  const skip = (reason: string): ResearchedReportOutcome => ({ outcome: 'skipped', reportId: null, reason })
  if (!isLocalDate(a.observedOn) || !isLocalDate(a.source.checkedOn)) return skip('Not a YYYY-MM-DD date')
  if (a.observedOn > localDateOf(now, a.timezone)) return skip(`Observed on ${a.observedOn}, which is still in the future at the resort`)
  if (a.observedOn > a.source.checkedOn) return skip(`Observed on ${a.observedOn}, after the research date ${a.source.checkedOn}`)
  const status = a.operatingStatus ? RESEARCHED_STATUS[a.operatingStatus] : null
  const note = a.note?.replace(/\s+/g, ' ').trim() || null
  const measured = [a.baseDepthCm, a.summitDepthCm, a.newSnow24hCm, a.liftsOpen, a.liftsTotal].some((x) => x !== null)
  if (!status && !measured && !note) return skip('Nothing reported')

  const checked = `${a.source.checkedOn}T12:00:00.000Z`
  const fetchedAt = checked < now ? checked : (canonicalInstant(now) ?? now)
  const parsed: ParsedReport = {
    localDate: a.observedOn,
    reportedAt: null,
    status,
    snowfall: a.newSnow24hCm !== null ? [{ window: '24h', amountCm: a.newSnow24hCm, sourceText: null }] : [],
    baseDepthCm: a.baseDepthCm,
    baseDepthLocation: null,
    summitDepthCm: a.summitDepthCm,
    surfaceTags: [],
    surfaceText: null,
    groomingText: null,
    groomedRuns: null,
    snowmakingText: null,
    openTrails: null,
    totalTrails: null,
    openLifts: a.liftsOpen,
    totalLifts: a.liftsTotal,
    openBeginnerTrails: null,
    totalBeginnerTrails: null,
    openAcres: null,
    notes: note,
  }
  const n = normalizeReport(parsed)
  const hash = reportContentHash(n)
  const same = await db
    .select({ id: operationalReports.id })
    .from(operationalReports)
    .where(
      and(
        eq(operationalReports.resortId, a.resortId),
        eq(operationalReports.localDate, a.observedOn),
        eq(operationalReports.kind, 'official'),
        eq(operationalReports.contentHash, hash),
      ),
    )
    .limit(1)
  if (same[0]) return { outcome: 'unchanged', reportId: same[0].id, reason: null }

  const prov = provenance({
    kind: 'official',
    provider: a.provider,
    sourceUrl: a.source.url,
    fetchedAt,
    verification: researchVerification(a.source.verification),
    note: RESEARCHED_REPORT_NOTE,
  })
  const revision = await nextRevision(db, a.resortId, a.observedOn, 'official')
  const [row] = await db
    .insert(operationalReports)
    .values({ resortId: a.resortId, revision, kind: 'official', fetchedAt, contentHash: hash, prov, createdAt: fetchedAt, ...reportRowValues(n) })
    .returning({ id: operationalReports.id })

  if (status) {
    await recordStatus(db, {
      resortId: a.resortId,
      status,
      localDate: a.observedOn,
      effectiveAt: statementTime(localTimeToInstant(a.observedOn, '12:00', a.timezone), fetchedAt),
      prov,
      note: `Found by catalog research for ${formatLocalDate(a.observedOn)} — confirm at source`,
    })
    if (status !== 'open') await applyStatusToSeason(db, { resortId: a.resortId, status, localDate: a.observedOn, prov, now })
  }
  return { outcome: 'inserted', reportId: row.id, reason: null }
}

/** Resort-local date "today" for a report entered now (helper for forms). */
export function reportDateFor(now: string, timezone: string): string {
  return localDateOf(now, timezone)
}
