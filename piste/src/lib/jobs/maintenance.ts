/** Link checks, FX rates and retention pruning. */
import { desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  airports,
  events,
  expenses,
  fxRates,
  hotels,
  lessons,
  linkChecks,
  passFamilies,
  passOwnership,
  priceSnapshots,
  refreshRuns,
  resorts,
  sourceRecords,
  tripItems,
  userPreferences,
  weatherAlerts,
} from '@/lib/db/schema'
import { successTargets } from './success'
import { STOPPED_NOTE, type ItemOutcome, type JobContext, type JobWorkResult } from './types'
import { chunk, daysBefore, defaultSleep, errorMessage } from './util'
import { historyPolicy, pruneAssessments } from './retention'
import { DEFAULT_WEATHER_RETENTION_DAYS, pruneWeatherRuns, recordFetches } from './weather'

// ---------------------------------------------------------------------------
// Links

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)

/** Every external link Piste shows (resort links, report sources, events, hotels, pass pages, airports). */
export async function collectLinks(db: Db): Promise<string[]> {
  const urls = new Set<string>()
  const add = (u: unknown) => {
    if (isHttp(u)) urls.add(u.trim())
  }
  for (const r of await db.select({ links: resorts.links, reportSource: resorts.reportSource }).from(resorts)) {
    for (const [k, v] of Object.entries(r.links ?? {})) {
      if (k === 'more' && Array.isArray(v)) for (const m of v) add((m as { url?: unknown }).url)
      else add(v)
    }
    add(r.reportSource?.url)
  }
  for (const e of await db.select({ a: events.officialUrl, b: events.ticketUrl }).from(events)) {
    add(e.a)
    add(e.b)
  }
  for (const h of await db.select({ a: hotels.officialUrl }).from(hotels)) add(h.a)
  for (const p of await db.select({ links: passFamilies.links }).from(passFamilies)) for (const v of Object.values(p.links ?? {})) add(v)
  for (const a of await db.select({ a: airports.officialUrl, b: airports.airlinesUrl }).from(airports)) {
    add(a.a)
    add(a.b)
  }
  return [...urls].sort()
}

export interface LinkJobOptions {
  /** Re-check links older than this. */
  recheckHours?: number
  /** Upper bound per run; the oldest checks go first, the rest wait for the next run. */
  maxPerRun?: number
  /** Pause between requests (politeness). */
  delayMs?: number
}

export async function refreshLinks(ctx: JobContext, opts: LinkJobOptions = {}): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: links are not checked'] }
  const check = deps.checkLink
  if (!check) return { items: [], notes: ['No link checker configured'] }
  const sleep = deps.sleep ?? defaultSleep
  const cutoff = daysBefore(now, (opts.recheckHours ?? 20) / 24)
  const all = await collectLinks(db)
  const checks = new Map((await db.select().from(linkChecks)).map((c) => [c.url, c]))
  const due = all
    .filter((u) => !checks.get(u) || checks.get(u)!.checkedAt < cutoff)
    .sort((a, b) => (checks.get(a)?.checkedAt ?? '').localeCompare(checks.get(b)?.checkedAt ?? ''))
    .slice(0, opts.maxPerRun ?? 300)
  const items: ItemOutcome[] = []
  for (const [i, url] of due.entries()) {
    if (ctx.signal?.aborted) return { items, notes: [STOPPED_NOTE] }
    try {
      const r = await check(url)
      const row = { url, checkedAt: r.checkedAt ?? now, httpStatus: r.httpStatus, ok: r.ok, finalUrl: r.finalUrl, error: r.error, embeddable: r.embeddable }
      await db.insert(linkChecks).values(row).onConflictDoUpdate({ target: linkChecks.url, set: row })
      // A broken link is a finding about the link, not a failure of the job.
      items.push({ key: url, target: null, ok: true, written: 1, error: r.ok ? null : (r.error ?? `HTTP ${r.httpStatus ?? '?'}`) })
    } catch (e) {
      items.push({ key: url, target: null, ok: false, written: 0, error: errorMessage(e) })
    }
    if (i < due.length - 1 && (opts.delayMs ?? 250) > 0) await sleep(opts.delayMs ?? 250)
  }
  const broken = items.filter((i) => i.ok && i.error).length
  return { items, notes: [`${due.length} of ${all.length} links checked, ${broken} broken`] }
}

// ---------------------------------------------------------------------------
// FX

/** Currencies that appear anywhere in personal or price records, besides the display currency. */
export async function currenciesInUse(db: Db): Promise<string[]> {
  const set = new Set<string>()
  const add = (c: string | null | undefined) => {
    if (c && /^[A-Z]{3}$/.test(c.toUpperCase())) set.add(c.toUpperCase())
  }
  for (const r of await db.selectDistinct({ c: priceSnapshots.currency }).from(priceSnapshots)) add(r.c)
  for (const r of await db.selectDistinct({ c: tripItems.currency }).from(tripItems)) add(r.c)
  for (const r of await db.selectDistinct({ c: expenses.currency }).from(expenses)) add(r.c)
  for (const r of await db.selectDistinct({ c: events.currency }).from(events)) add(r.c)
  for (const r of await db.selectDistinct({ c: passOwnership.currency }).from(passOwnership)) add(r.c)
  for (const r of await db.selectDistinct({ c: lessons.currency }).from(lessons)) add(r.c)
  return [...set].sort()
}

export async function refreshFx(ctx: JobContext): Promise<JobWorkResult> {
  const { db, now, deps } = ctx
  if (deps.demo) return { items: [], notes: ['Demo database: FX rates are not fetched'] }
  const provider = deps.fxProvider
  if (!provider) return { items: [], notes: ['No FX provider configured'] }
  const prefs = (await db.select().from(userPreferences).where(eq(userPreferences.id, 1)))[0]
  const base = (prefs?.currency ?? 'USD').toUpperCase()
  const quotes = (await currenciesInUse(db)).filter((c) => c !== base)
  const key = `${provider.id}:${base}`
  if (quotes.length === 0) return { items: [{ key, target: null, ok: true, skipped: true, written: 0 }], notes: ['No foreign currencies in use'] }
  try {
    const res = await provider.fetchRates(base, quotes)
    await recordFetches(db, { adapter: provider.id, resortId: null, result: res })
    if (!res.ok) return { items: [{ key, target: null, ok: false, written: 0, error: `${res.errorKind}: ${res.error}` }] }
    let written = 0
    for (const q of res.data) {
      const inserted = await db
        .insert(fxRates)
        .values({ base: q.base, quote: q.quote, rate: q.rate, rateDate: q.rateDate, provider: provider.id, fetchedAt: now, kind: res.provenance.kind })
        .onConflictDoNothing()
        .returning({ quote: fxRates.quote })
      written += inserted.length
    }
    const missing = quotes.filter((q) => !res.data.some((d) => d.quote === q))
    return {
      items: [{ key, target: null, ok: true, written }],
      notes: missing.length ? [`No rate supplied for ${missing.join(', ')} — conversions stay unavailable`] : [],
    }
  } catch (e) {
    return { items: [{ key, target: null, ok: false, written: 0, error: errorMessage(e) }] }
  }
}

// ---------------------------------------------------------------------------
// Pruning

export interface PruneOptions {
  weatherKeepDays?: number
  sourceRecordKeepDays?: number
  refreshRunKeepDays?: number
  /**
   * VACUUM after a pass that deleted rows, so the database file shrinks instead of keeping free pages
   * (default: PISTE_PRUNE_VACUUM=1; the single-file build sets it because it saves the whole file).
   */
  vacuum?: boolean
}

/**
 * Daily retention: weather runs and assessments (rules in ./retention.ts — only what a screen, the history calendar or
 * an alert still reads is kept), old source-record fetch logs (the latest record per adapter/resort/url is always
 * kept), old refresh-run bookkeeping, and expired official alerts. Item `written` counts are rows deleted.
 */
export async function pruneAll(ctx: JobContext, opts: PruneOptions = {}): Promise<JobWorkResult> {
  const { db, now } = ctx
  const items: ItemOutcome[] = []
  const step = async (key: string, fn: () => Promise<number>) => {
    try {
      items.push({ key, target: null, ok: true, written: await fn() })
    } catch (e) {
      items.push({ key, target: null, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  const envDays = Number(process.env.PISTE_WEATHER_RETENTION_DAYS)
  const keepDays = opts.weatherKeepDays ?? (envDays > 0 ? envDays : DEFAULT_WEATHER_RETENTION_DAYS)
  const policy = historyPolicy()
  let weatherHours = 0
  await step('weather-runs', async () => {
    const r = await pruneWeatherRuns(db, now, keepDays, policy)
    weatherHours = r.pointsDeleted
    return r.runsDeleted
  })
  if (weatherHours > 0) items.push({ key: 'weather-hours', target: null, ok: true, written: weatherHours })
  let compacted = 0
  await step('assessments', async () => {
    const r = await pruneAssessments(db, now, policy)
    compacted = r.compacted
    return r.deleted
  })
  if (compacted > 0) items.push({ key: 'assessment-details', target: null, ok: true, written: compacted })
  await step('source-records', async () => {
    const cutoff = daysBefore(now, opts.sourceRecordKeepDays ?? 30)
    const rows = await db
      .select({ id: sourceRecords.id, adapter: sourceRecords.adapter, resortId: sourceRecords.resortId, url: sourceRecords.url, fetchedAt: sourceRecords.fetchedAt, ok: sourceRecords.ok })
      .from(sourceRecords)
      .orderBy(desc(sourceRecords.fetchedAt), desc(sourceRecords.id))
    // The newest record of each adapter/resort/url is kept whatever its age, so Sources always shows the last state —
    // and so is the newest SUCCESSFUL one: its extract is the last good data (a resort's OpenStreetMap lifts and runs
    // are read from it), which no run of failures may prune away.
    const seen = new Set<string>()
    const seenOk = new Set<string>()
    const doomed: number[] = []
    for (const r of rows) {
      const k = `${r.adapter}|${r.resortId ?? ''}|${r.url}`
      const newest = !seen.has(k)
      const newestOk = r.ok && !seenOk.has(k)
      seen.add(k)
      if (r.ok) seenOk.add(k)
      if (!newest && !newestOk && r.fetchedAt < cutoff) doomed.push(r.id)
    }
    for (const ids of chunk(doomed, 400)) await db.delete(sourceRecords).where(inArray(sourceRecords.id, ids))
    return doomed.length
  })
  await step('refresh-runs', async () => {
    const cutoff = daysBefore(now, opts.refreshRunKeepDays ?? 60)
    const skippedCutoff = daysBefore(now, 7)
    const rows = await db
      .select({
        id: refreshRuns.id,
        job: refreshRuns.job,
        target: refreshRuns.target,
        status: refreshRuns.status,
        startedAt: refreshRuns.startedAt,
        details: refreshRuns.details,
      })
      .from(refreshRuns)
      .orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id))
    // The run "last successful update" points at is kept whatever its age, for the job and for every resort:
    // it must never turn into "never" just because a source has been failing for a long time. Per-resort successes
    // live in the items of global runs, so walking newest first, a run is kept while it is the newest success for
    // any job + target it counts for (the same predicate lastSuccess uses).
    const seenSuccess = new Set<string>()
    const doomed: number[] = []
    for (const r of rows) {
      if (r.status === 'running') continue
      let newestForSome = false
      for (const t of successTargets(r)) {
        const k = `${r.job}|${t ?? ''}`
        if (seenSuccess.has(k)) continue
        seenSuccess.add(k)
        newestForSome = true
      }
      if (newestForSome) continue
      if (r.startedAt < cutoff || (r.status === 'skipped' && r.startedAt < skippedCutoff)) doomed.push(r.id)
    }
    for (const ids of chunk(doomed, 400)) await db.delete(refreshRuns).where(inArray(refreshRuns.id, ids))
    return doomed.length
  })
  await step('weather-alerts', async () => (await db.delete(weatherAlerts).where(lt(weatherAlerts.ends, now)).returning({ id: weatherAlerts.id })).length)
  const vacuum = opts.vacuum ?? process.env.PISTE_PRUNE_VACUUM === '1'
  if (vacuum && items.some((i) => i.written > 0)) {
    // Outside any transaction (SQLite refuses VACUUM inside one). Not counted as rows written. A page size set with
    // PISTE_DB_PAGE_SIZE takes effect here (not in WAL mode): larger pages pack the 2–4 KB assessment rows better.
    await step('vacuum', async () => {
      const pageSize = Number(process.env.PISTE_DB_PAGE_SIZE)
      if ([4096, 8192, 16384, 32768, 65536].includes(pageSize)) await db.run(sql.raw(`PRAGMA page_size = ${pageSize}`))
      await db.run(sql`VACUUM`)
      return 0
    })
  }
  return { items }
}
