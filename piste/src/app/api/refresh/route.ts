/**
 * POST /api/refresh — manual refresh of one job.
 *
 * Body: `{ "job": "weather" | "nws-alerts" | "reports" | "osm" | "status" | "assessments" | "alerts" | "links" | "fx",
 *          "target": "<resort id>" | null }` — "osm" (OpenStreetMap lifts & runs) needs a target: one resort at a time.
 *
 * Responses (JSON `RunSummary` + `followUps` + `mode`):
 * - 200 — the run finished (status ok / partial / error; a failed run never advances "last successful update").
 * - 429 — on cooldown (10 min per job + target); `nextAllowedAt` and `Retry-After` say when to try again.
 * - 409 — already running, or a live-source job requested in demo mode (demo data is never refreshed from live
 *   sources).
 * - 400 / 404 / 422 — invalid body, unknown resort, no report adapter for the resort, or a turned-off connector.
 * After new weather/report/status data, assessments for the target and alerts are recomputed (no cooldown).
 */
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { nowFor } from '@/lib/clock'
import { getCtx } from '@/lib/context'
import { resorts } from '@/lib/db/schema'
import { hoursBetween } from '@/lib/domain/time'
import { defaultDeps } from '@/lib/jobs/deps'
import { runJob, type RunSummary } from '@/lib/jobs/runner'
import { EXTERNAL_JOBS, type JobName } from '@/lib/jobs/types'
import { isSameOrigin, jsonError } from '../_shared'

const MANUAL_JOBS = ['weather', 'nws-alerts', 'reports', 'osm', 'status', 'assessments', 'alerts', 'links', 'fx'] as const
const GLOBAL_ONLY: readonly JobName[] = ['alerts', 'links', 'fx']
/** One resort at a time (the scheduler loads favourites and trip resorts on its own, per resort). */
const TARGET_ONLY: readonly JobName[] = ['osm']
const EVIDENCE_JOBS: readonly JobName[] = ['weather', 'nws-alerts', 'reports', 'status']

const Body = z.object({
  job: z.enum(MANUAL_JOBS),
  target: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Expected a resort id')
    .nullable()
    .optional(),
})

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, 'Cross-origin request refused')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Expected a JSON body: { job, target }')
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return jsonError(400, 'Invalid refresh request', { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
  const job: JobName = parsed.data.job
  const target = parsed.data.target ?? null
  if (target && GLOBAL_ONLY.includes(job)) return jsonError(400, `"${job}" refreshes everything; omit target`)
  if (!target && TARGET_ONLY.includes(job)) return jsonError(400, `"${job}" loads one resort at a time; give target`)

  const ctx = await getCtx()
  const demo = ctx.mode === 'demo'
  if (demo && EXTERNAL_JOBS.includes(job)) {
    return jsonError(409, 'Demo mode: live sources are never fetched into demo data. Switch to live mode to refresh.', { mode: ctx.mode })
  }
  if (target) {
    const found = await ctx.db.select({ id: resorts.id }).from(resorts).where(eq(resorts.id, target))
    if (!found[0]) return jsonError(404, `Unknown resort: ${target}`)
  }
  const deps = defaultDeps({ demo })
  if (job === 'reports' && target && !deps.reportProviders.some((p) => p.resortId === target)) {
    return jsonError(422, 'No official report adapter for this resort — use the official link and manual report entry.')
  }
  if (job === 'osm' && !deps.osmProvider) return jsonError(422, 'The OpenStreetMap lifts & runs connector is turned off.')

  const clock = () => nowFor(ctx.mode)
  // The demo clock is frozen, so a cooldown would never expire there; demo runs are local computations only.
  const cooldownMinutes = demo ? 0 : undefined
  const summary = await runJob({ db: ctx.db, job, target, trigger: 'manual', now: ctx.now, deps, clock, cooldownMinutes })

  const followUps: RunSummary[] = []
  if (summary.changed && EVIDENCE_JOBS.includes(job)) {
    followUps.push(await runJob({ db: ctx.db, job: 'assessments', target, trigger: 'manual', now: clock(), deps, clock, cooldownMinutes: 0 }))
    followUps.push(await runJob({ db: ctx.db, job: 'alerts', target: null, trigger: 'manual', now: clock(), deps, clock, cooldownMinutes: 0 }))
  }
  if (summary.changed || followUps.some((f) => f.changed)) revalidatePath('/', 'layout')

  const payload = { ...summary, followUps, mode: ctx.mode }
  if (summary.status === 'skipped') {
    if (summary.nextAllowedAt) {
      const seconds = Math.max(1, Math.ceil(hoursBetween(ctx.now, summary.nextAllowedAt) * 3600))
      return Response.json(payload, { status: 429, headers: { 'retry-after': String(seconds), 'cache-control': 'no-store' } })
    }
    return Response.json(payload, { status: 409, headers: { 'cache-control': 'no-store' } })
  }
  return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
}
