/**
 * In-app alerts. Rules are evaluated statelessly against recent data; every candidate carries a dedupe key
 * `type:subject:bucket` (unique in the alerts table) and each rule has a per-subject cooldown, so repeated
 * forecast refreshes never spam. A candidate held back by a cooldown is not lost: it fires on a later evaluation
 * if the condition still holds.
 *
 * Rule types: opening-date-change, resort-opened, pass-deadline, snow-threshold, forecast-deterioration, event,
 * price-change. Default rules are created once per favorite (and once globally); deleting them is respected.
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import {
  alertRules,
  alerts,
  conditionsAssessments,
  events,
  favorites,
  openingDateHistory,
  passProducts,
  priceSnapshots,
  resorts,
  tripItems,
  trips,
  userPreferences,
  type AlertType,
} from '@/lib/db/schema'
import type { AlertRuleRow, ResortRow } from '@/lib/db/rows'
import { prepareSeries, slotsWithin } from '@/lib/domain/conditions'
import { formatMoney } from '@/lib/domain/money'
import { daysBetween, formatLocalDate, localDateOf } from '@/lib/domain/time'
import { DEFAULT_UNITS, SCORING_MODES, type UnitPrefs } from '@/lib/domain/types'
import { formatSnow } from '@/lib/domain/units'
import type { ItemOutcome, JobContext, JobWorkResult } from './types'
import { daysBefore, errorMessage, getMeta, hashJson, setMeta } from './util'
import { latestOkRuns, loadRunSeries } from './weather'

// ---------------------------------------------------------------------------
// Rule params (validated, with defaults)

export const RULE_PARAMS = {
  'opening-date-change': z.object({ lookbackDays: z.number().int().min(1).max(60).default(14) }),
  'resort-opened': z.object({ lookbackDays: z.number().int().min(1).max(60).default(14) }),
  'pass-deadline': z.object({ withinDays: z.number().int().min(1).max(60).default(14), productIds: z.array(z.string()).optional() }),
  'snow-threshold': z.object({ thresholdCm: z.number().min(1).max(300).default(15), windowHours: z.number().int().min(6).max(168).default(72) }),
  'forecast-deterioration': z.object({ minDrop: z.number().int().min(1).max(100).default(15), mode: z.enum(SCORING_MODES).optional() }),
  event: z.object({}),
  'price-change': z.object({ lookbackDays: z.number().int().min(1).max(365).default(30) }),
} satisfies Record<AlertType, z.ZodTypeAny>

export interface AlertCandidate {
  type: AlertType
  /** Stable subject id (resort, product, event, price series …). Cooldowns apply per rule + subject. */
  subject: string
  /** Value bucket: a new bucket for the same subject is a new alert. */
  bucket: string
  resortId: string | null
  title: string
  body: string
  link: string | null
  /** Called after the candidate was fired or found already fired (e.g. to mark an event as seen). */
  onSettled?: () => Promise<void>
}

export const dedupeKeyOf = (c: Pick<AlertCandidate, 'type' | 'subject' | 'bucket'>) => `${c.type}:${c.subject}:${c.bucket}`

// ---------------------------------------------------------------------------
// Defaults

/** Bookkeeping JSON in app_meta; a damaged value falls back instead of stopping every alert. */
function parseMeta<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw) as T
    return v && typeof v === 'object' ? v : fallback
  } catch {
    return fallback
  }
}

const DEFAULTS_META = 'alerts.defaults'

/** Create default rules once per favorite (and once globally). Rules the user deleted are not recreated. */
export async function ensureDefaultAlertRules(db: Db, now: string): Promise<number> {
  const done = parseMeta<{ resorts: string[]; global: boolean }>(await getMeta(db, DEFAULTS_META), { resorts: [], global: false })
  const favs = await db.select().from(favorites).orderBy(favorites.sortOrder)
  const existing = await db.select().from(alertRules)
  let created = 0
  const add = async (type: AlertType, resortId: string | null, params: Record<string, unknown>) => {
    await db.insert(alertRules).values({ type, resortId, params, enabled: true, cooldownHours: 12, createdAt: now })
    created++
  }
  for (const f of favs) {
    if (done.resorts.includes(f.resortId)) continue
    if (!existing.some((r) => r.resortId === f.resortId)) {
      await add('opening-date-change', f.resortId, { lookbackDays: 14 })
      await add('resort-opened', f.resortId, { lookbackDays: 14 })
      await add('snow-threshold', f.resortId, { thresholdCm: 15, windowHours: 72 })
    }
    done.resorts.push(f.resortId)
  }
  if (!done.global) {
    if (!existing.some((r) => r.resortId === null)) {
      await add('pass-deadline', null, { withinDays: 14 })
      await add('forecast-deterioration', null, { minDrop: 15 })
      await add('event', null, {})
      await add('price-change', null, { lookbackDays: 30 })
    }
    done.global = true
  }
  await setMeta(db, DEFAULTS_META, JSON.stringify(done), now)
  return created
}

// ---------------------------------------------------------------------------
// Evaluation context

interface EvalCtx {
  db: Db
  now: string
  today: string
  units: UnitPrefs
  scoringMode: (typeof SCORING_MODES)[number]
  resorts: Map<string, ResortRow>
  favoriteIds: string[]
  tripResortIds: string[]
}

async function loadEvalCtx(db: Db, now: string): Promise<EvalCtx> {
  const prefs = (await db.select().from(userPreferences).where(eq(userPreferences.id, 1)))[0]
  const tz = prefs?.homeTimezone ?? 'America/New_York'
  const today = localDateOf(now, tz)
  const all = await db.select().from(resorts)
  const favs = await db.select().from(favorites)
  const activeTrips = await db.select().from(trips).where(and(inArray(trips.status, ['draft', 'booked']), gte(trips.endDate, today)))
  const items = activeTrips.length
    ? await db.select().from(tripItems).where(inArray(tripItems.tripId, activeTrips.map((t) => t.id)))
    : []
  const resortIds = new Set(all.map((r) => r.id))
  return {
    db,
    now,
    today,
    units: prefs?.units ?? DEFAULT_UNITS,
    scoringMode: prefs?.scoringMode ?? 'learning',
    resorts: new Map(all.map((r) => [r.id, r])),
    favoriteIds: favs.map((f) => f.resortId),
    tripResortIds: [...new Set(items.map((i) => i.refId).filter((id): id is string => !!id && resortIds.has(id)))],
  }
}

const scopeResorts = (rule: AlertRuleRow, c: EvalCtx, includeTrips = false) =>
  rule.resortId ? [rule.resortId] : [...new Set([...c.favoriteIds, ...(includeTrips ? c.tripResortIds : [])])]
const nameOf = (c: EvalCtx, id: string | null) => (id ? (c.resorts.get(id)?.shortName ?? c.resorts.get(id)?.name ?? id) : '')
const FIELD_LABEL = { announcedOpening: 'announced opening', announcedClosing: 'announced closing', actualOpening: 'actual opening', actualClosing: 'actual closing' } as const

// ---------------------------------------------------------------------------
// Per-type candidate builders

async function openingDateChanges(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['opening-date-change'].parse(rule.params ?? {})
  const ids = scopeResorts(rule, c)
  if (ids.length === 0) return []
  const rows = await c.db
    .select()
    .from(openingDateHistory)
    .where(
      and(
        inArray(openingDateHistory.resortId, ids),
        inArray(openingDateHistory.field, ['announcedOpening', 'announcedClosing']),
        gte(openingDateHistory.changedAt, daysBefore(c.now, p.lookbackDays)),
      ),
    )
    .orderBy(openingDateHistory.changedAt)
  return rows.map((h) => {
    const label = FIELD_LABEL[h.field]
    const name = nameOf(c, h.resortId)
    const to = h.newValue ? formatLocalDate(h.newValue, 'ccc d LLL yyyy') : 'no date'
    const from = h.previousValue ? formatLocalDate(h.previousValue, 'ccc d LLL yyyy') : null
    return {
      type: 'opening-date-change' as const,
      subject: `${h.resortId}/${h.seasonId}/${h.field}`,
      bucket: h.newValue ?? 'removed',
      resortId: h.resortId,
      title: from ? `${name}: ${label} changed to ${to}` : `${name}: ${label} ${h.newValue ? `set to ${to}` : 'removed'}`,
      body: `${from ? `Previously ${from}. ` : ''}${h.field === 'announcedOpening' ? 'An announced date is a target and depends on operations and weather. ' : ''}Source: ${h.prov?.provider ?? 'unknown'}${h.prov?.sourceUrl ? ` (${h.prov.sourceUrl})` : ''}.`,
      link: `/resorts/${h.resortId}`,
    }
  })
}

async function resortOpenings(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['resort-opened'].parse(rule.params ?? {})
  const ids = scopeResorts(rule, c)
  if (ids.length === 0) return []
  const rows = await c.db
    .select()
    .from(openingDateHistory)
    .where(
      and(
        inArray(openingDateHistory.resortId, ids),
        eq(openingDateHistory.field, 'actualOpening'),
        gte(openingDateHistory.changedAt, daysBefore(c.now, p.lookbackDays)),
      ),
    )
  return rows
    .filter((h) => h.newValue !== null)
    .map((h) => ({
      type: 'resort-opened' as const,
      subject: h.resortId,
      bucket: h.seasonId,
      resortId: h.resortId,
      title: `${nameOf(c, h.resortId)} opened for the ${h.seasonId} season`,
      body: `Opening confirmed for ${formatLocalDate(h.newValue!, 'ccc d LLL yyyy')} by ${h.prov?.provider ?? 'an official statement'}. Check today's report for open terrain.`,
      link: `/resorts/${h.resortId}`,
    }))
}

async function passDeadlines(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['pass-deadline'].parse(rule.params ?? {})
  const rows = await c.db.select().from(passProducts)
  const out: AlertCandidate[] = []
  for (const prod of rows) {
    if (!prod.salesDeadline || (p.productIds && !p.productIds.includes(prod.id))) continue
    const days = daysBetween(c.today, prod.salesDeadline)
    if (days < 0 || days > p.withinDays) continue
    const stage = days <= 3 ? 'final-3d' : `within-${p.withinDays}d`
    out.push({
      type: 'pass-deadline',
      subject: prod.id,
      bucket: `${prod.salesDeadline}|${stage}`,
      resortId: prod.resortId,
      title: `${prod.name}: sales deadline ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`,
      body: `Deadline ${formatLocalDate(prod.salesDeadline, 'ccc d LLL yyyy')}${prod.salesDeadlineText ? ` — "${prod.salesDeadlineText}"` : ''}. Confirm on the official pass page before buying.`,
      link: '/passes',
    })
  }
  return out
}

async function snowThresholds(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['snow-threshold'].parse(rule.params ?? {})
  const out: AlertCandidate[] = []
  const from = DateTime.fromISO(c.now, { zone: 'utc' }).startOf('hour')
  const fromMs = from.toMillis()
  const toMs = from.plus({ hours: p.windowHours }).toMillis()
  for (const resortId of scopeResorts(rule, c)) {
    const resort = c.resorts.get(resortId)
    if (!resort) continue
    const runs = await latestOkRuns(c.db, resortId)
    // Upper mountain first; the primary (non-alternate) provider only.
    const run = ['summit', 'base']
      .map((k) => [...runs.values()].filter((r) => r.pointKey === k && r.kind !== 'demo').sort((a, b) => (a.provider === 'open-meteo' ? -1 : b.provider === 'open-meteo' ? 1 : 0))[0])
      .find((r) => !!r)
    if (!run) continue
    const s = await loadRunSeries(c.db, run)
    const slots = slotsWithin(prepareSeries(s.hourly, s.semantics), fromMs, toMs)
    let total = 0
    let crossedAt: number | null = null
    for (const slot of slots) {
      const v = slot.point.snowfallCm
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      total += v
      if (crossedAt === null && total >= p.thresholdCm) crossedAt = slot.startMs
    }
    if (crossedAt === null) continue
    const crossDate = localDateOf(DateTime.fromMillis(crossedAt, { zone: 'utc' }).toISO()!, resort.timezone)
    const amount = formatSnow(Math.round(total * 10) / 10, c.units) ?? `${Math.round(total)} cm`
    const threshold = formatSnow(p.thresholdCm, c.units) ?? `${p.thresholdCm} cm`
    out.push({
      type: 'snow-threshold',
      subject: resortId,
      bucket: `${crossDate}|${p.thresholdCm}`,
      resortId,
      title: `${resort.shortName}: likely ${amount} of snow in the next ${p.windowHours} h`,
      body: `Modeled snowfall (${run.prov?.provider ?? run.provider}${run.model ? `, ${run.model}` : ''}) at the ${run.pointKey} point passes your ${threshold} threshold around ${formatLocalDate(crossDate)}. A forecast, not an observation — it can change.`,
      link: `/resorts/${resortId}`,
    })
  }
  return out
}

async function forecastDeterioration(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['forecast-deterioration'].parse(rule.params ?? {})
  const mode = p.mode ?? c.scoringMode
  const activeTrips = await c.db.select().from(trips).where(and(inArray(trips.status, ['draft', 'booked']), gte(trips.endDate, c.today)))
  if (activeTrips.length === 0) return []
  const items = await c.db
    .select()
    .from(tripItems)
    .where(and(inArray(tripItems.tripId, activeTrips.map((t) => t.id)), eq(tripItems.type, 'resort-day')))
  const out: AlertCandidate[] = []
  for (const item of items) {
    if (!item.refId || !item.date || (rule.resortId && item.refId !== rule.resortId)) continue
    const trip = activeTrips.find((t) => t.id === item.tripId)!
    const resort = c.resorts.get(item.refId)
    if (!resort || item.date < localDateOf(c.now, resort.timezone)) continue
    const rows = await c.db
      .select()
      .from(conditionsAssessments)
      .where(and(eq(conditionsAssessments.resortId, item.refId), eq(conditionsAssessments.localDate, item.date), eq(conditionsAssessments.mode, mode)))
      .orderBy(desc(conditionsAssessments.computedAt), desc(conditionsAssessments.id))
    const latest = rows[0]
    if (!latest || latest.kind === 'demo') continue
    const earlier = rows.slice(1).filter((r) => r.computedAt >= trip.createdAt)
    const subject = `${item.refId}/${item.date}/${mode}`
    const when = formatLocalDate(item.date)
    if (latest.scoreKind === 'closed' && earlier.some((r) => r.scoreKind !== 'closed')) {
      out.push({
        type: 'forecast-deterioration',
        subject,
        bucket: 'closed',
        resortId: item.refId,
        title: `${resort.shortName} on ${when}: reported closed`,
        body: `A confirmed closure now applies to a day in "${trip.name}". Check the official status before travelling.`,
        link: `/trips/${trip.id}`,
      })
      continue
    }
    if (latest.score === null) continue
    const comparable = earlier.filter((r) => r.scoreKind === latest.scoreKind && r.score !== null).map((r) => r.score!)
    if (comparable.length === 0) continue
    const best = Math.max(...comparable)
    if (best - latest.score < p.minDrop) continue
    out.push({
      type: 'forecast-deterioration',
      subject,
      bucket: `${latest.scoreKind}|${Math.floor(latest.score / 10)}`,
      resortId: item.refId,
      title: `${resort.shortName} on ${when}: outlook fell to ${latest.score}${latest.descriptor ? ` (${latest.descriptor})` : ''}`,
      body: `Down from ${best} since you planned "${trip.name}". ${latest.scoreKind === 'weather-potential' ? 'Weather potential only — terrain status for that day is not known yet. ' : ''}Scores describe suitability, not safety.`,
      link: `/trips/${trip.id}`,
    })
  }
  return out
}

const EVENTS_SEEN_META = 'alerts.events.seen'

async function markEventsSeen(db: Db, updates: Record<string, Record<string, string>>, now: string) {
  if (Object.keys(updates).length === 0) return
  const cur = parseMeta<Record<string, Record<string, string>>>(await getMeta(db, EVENTS_SEEN_META), {})
  for (const [rid, fps] of Object.entries(updates)) cur[rid] = { ...(cur[rid] ?? {}), ...fps }
  await setMeta(db, EVENTS_SEEN_META, JSON.stringify(cur), now)
}

async function eventChanges(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const ids = scopeResorts(rule, c, true)
  if (ids.length === 0) return []
  const seen = parseMeta<Record<string, Record<string, string>>>(await getMeta(c.db, EVENTS_SEEN_META), {})
  const rows = await c.db.select().from(events).where(inArray(events.resortId, ids))
  const out: AlertCandidate[] = []
  // Marked seen without alerting: a resort's existing events when it is first watched, and past events.
  const silent: Record<string, Record<string, string>> = {}
  for (const resortId of ids) {
    const mine = rows.filter((e) => e.resortId === resortId)
    const fps: Record<string, string> = Object.fromEntries(
      mine.map((e) => [e.id, hashJson([e.title, e.startLocal, e.endLocal, e.status, e.venue, e.ticketUrl, e.priceMinor, e.currency]).slice(0, 16)]),
    )
    const known = seen[resortId]
    if (!known) {
      silent[resortId] = fps
      continue
    }
    for (const e of mine) {
      const fp = fps[e.id]
      if (known[e.id] === fp) continue
      const lastDay = (e.endLocal ?? e.startLocal)?.slice(0, 10) ?? null
      if (lastDay && lastDay < c.today) {
        silent[resortId] = { ...(silent[resortId] ?? {}), [e.id]: fp }
        continue
      }
      const isNew = !(e.id in known)
      const date = e.startLocal ? formatLocalDate(e.startLocal.slice(0, 10), 'ccc d LLL yyyy') : 'date not announced'
      out.push({
        type: 'event',
        subject: e.id,
        bucket: fp,
        resortId,
        title: `${isNew ? 'New event' : 'Event updated'} at ${nameOf(c, resortId)}: ${e.title}`,
        body: `${date}${e.status !== 'announced' ? ` (${e.status})` : ''}. ${e.officialUrl ? `Details: ${e.officialUrl}` : 'Confirm details with the organizer.'}`,
        link: `/resorts/${resortId}`,
        // Marked seen only once fired (or already sent): a cooldown-held change fires later.
        onSettled: () => markEventsSeen(c.db, { [resortId]: { [e.id]: fp } }, c.now),
      })
    }
  }
  await markEventsSeen(c.db, silent, c.now)
  return out
}

const VERIFIED = new Set(['api', 'official-page', 'user-confirmed'])

async function priceChanges(rule: AlertRuleRow, c: EvalCtx): Promise<AlertCandidate[]> {
  const p = RULE_PARAMS['price-change'].parse(rule.params ?? {})
  const rows = await c.db
    .select()
    .from(priceSnapshots)
    .where(and(inArray(priceSnapshots.quoteKind, ['published', 'observed-quote']), rule.resortId ? eq(priceSnapshots.resortId, rule.resortId) : undefined))
  const verified = rows.filter((r) => r.prov.kind !== 'demo' && VERIFIED.has(r.prov.verification ?? ''))
  const groups = new Map<string, typeof verified>()
  for (const r of verified) {
    // Weekday vs weekend or different seasons are different prices, not changes.
    const k = [r.subjectType, r.subjectId, r.item, r.category ?? '', r.dayType ?? '', r.seasonId ?? ''].join('/')
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const since = daysBefore(c.now, p.lookbackDays)
  const out: AlertCandidate[] = []
  for (const [k, list] of groups) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id - b.id)
    const cur = sorted[sorted.length - 1]
    const prev = sorted[sorted.length - 2]
    if (cur.observedAt < since) continue
    if (cur.amountMinor === prev.amountMinor && cur.currency === prev.currency && cur.amountMaxMinor === prev.amountMaxMinor) continue
    const fmt = (r: typeof cur) => formatMoney({ amountMinor: r.amountMinor, currency: r.currency })
    const subjectName = cur.resortId ? nameOf(c, cur.resortId) : cur.subjectId
    out.push({
      type: 'price-change',
      subject: k,
      bucket: String(cur.id),
      resortId: cur.resortId,
      title: `${subjectName}: ${cur.item}${cur.category ? ` (${cur.category})` : ''} now ${fmt(cur)}`,
      body: `Was ${fmt(prev)} (observed ${prev.observedAt.slice(0, 10)}); now ${fmt(cur)} (observed ${cur.observedAt.slice(0, 10)}, ${cur.prov.provider ?? 'source unknown'}). Prices in the original currency.`,
      link: cur.subjectType === 'pass-product' ? '/passes' : cur.resortId ? `/resorts/${cur.resortId}` : null,
    })
  }
  return out
}

const BUILDERS: Record<AlertType, (rule: AlertRuleRow, c: EvalCtx) => Promise<AlertCandidate[]>> = {
  'opening-date-change': openingDateChanges,
  'resort-opened': resortOpenings,
  'pass-deadline': passDeadlines,
  'snow-threshold': snowThresholds,
  'forecast-deterioration': forecastDeterioration,
  event: eventChanges,
  'price-change': priceChanges,
}

// ---------------------------------------------------------------------------
// Firing

export type FireOutcome = 'fired' | 'duplicate' | 'cooldown'

/** Insert an alert unless its dedupe key exists or the rule's cooldown for this subject is active. */
export async function fireCandidate(db: Db, rule: Pick<AlertRuleRow, 'id' | 'cooldownHours'>, cand: AlertCandidate, now: string): Promise<FireOutcome> {
  const dedupeKey = dedupeKeyOf(cand)
  const dup = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.dedupeKey, dedupeKey)).limit(1)
  if (dup[0]) {
    await cand.onSettled?.()
    return 'duplicate'
  }
  if (rule.cooldownHours > 0) {
    const since = DateTime.fromISO(now, { zone: 'utc' }).minus({ hours: rule.cooldownHours }).toUTC().toISO()!
    const recent = await db
      .select({ key: alerts.dedupeKey })
      .from(alerts)
      .where(and(eq(alerts.ruleId, rule.id), gte(alerts.firedAt, since), lte(alerts.firedAt, now)))
    const prefix = `${cand.type}:${cand.subject}:`
    if (recent.some((r) => r.key.startsWith(prefix))) return 'cooldown'
  }
  const inserted = await db
    .insert(alerts)
    .values({ ruleId: rule.id, type: cand.type, dedupeKey, resortId: cand.resortId, title: cand.title, body: cand.body, link: cand.link, firedAt: now })
    .onConflictDoNothing({ target: alerts.dedupeKey })
    .returning({ id: alerts.id })
  if (!inserted[0]) return 'duplicate'
  await db.update(alertRules).set({ lastFiredAt: now }).where(eq(alertRules.id, rule.id))
  await cand.onSettled?.()
  return 'fired'
}

export interface AlertsEvaluation {
  fired: number
  duplicates: number
  cooldown: number
  defaultsCreated: number
}

/** Evaluate all enabled rules. Each rule is isolated: one failing rule never stops the others. */
export async function evaluateAlerts(ctx: JobContext): Promise<JobWorkResult> {
  const { db, now } = ctx
  // Demo data never feeds alerts.
  if (ctx.deps.demo) return { items: [], notes: ['Demo database: alerts are not evaluated from demo data'] }
  const defaultsCreated = await ensureDefaultAlertRules(db, now)
  const c = await loadEvalCtx(db, now)
  const rules = await db.select().from(alertRules).where(eq(alertRules.enabled, true)).orderBy(alertRules.id)
  const items: ItemOutcome[] = []
  const totals = { fired: 0, duplicates: 0, cooldown: 0 }
  for (const rule of rules) {
    const key = `rule-${rule.id}:${rule.type}${rule.resortId ? `:${rule.resortId}` : ''}`
    try {
      const builder = BUILDERS[rule.type]
      if (!builder) {
        items.push({ key, target: rule.resortId, ok: true, skipped: true, written: 0, error: `Unknown rule type ${rule.type}` })
        continue
      }
      const cands = await builder(rule, c)
      let fired = 0
      for (const cand of cands) {
        const res = await fireCandidate(db, rule, cand, now)
        if (res === 'fired') fired++
        else if (res === 'duplicate') totals.duplicates++
        else totals.cooldown++
      }
      totals.fired += fired
      items.push({ key, target: rule.resortId, ok: true, written: fired })
    } catch (e) {
      items.push({ key, target: rule.resortId, ok: false, written: 0, error: errorMessage(e) })
    }
  }
  return {
    items,
    notes: [`${totals.fired} fired, ${totals.duplicates} already sent, ${totals.cooldown} held by cooldown, ${defaultsCreated} default rules created`],
  }
}
