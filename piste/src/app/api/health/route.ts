/**
 * GET /api/health — scheduler heartbeat and last successful refresh per job.
 * `?strict=1` answers 503 when the scheduler heartbeat is stale (for external uptime checks).
 * A sleeping or powered-off machine collects nothing; a stale heartbeat says so rather than hiding it.
 */
import type { NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getCtx } from '@/lib/context'
import { refreshRuns } from '@/lib/db/schema'
import { hoursBetween } from '@/lib/domain/time'
import { lastSuccess } from '@/lib/jobs/runner'
import { HEARTBEAT_KEY } from '@/lib/jobs/schedule'
import { JOB_NAMES } from '@/lib/jobs/types'
import { getMeta } from '@/lib/jobs/util'
import { reportProviders } from '@/lib/providers/registry'

/** Heartbeat age (minutes) after which the scheduler counts as stale, per scheduler mode. */
function staleAfterMinutes(mode: string | null): number {
  const env = Number(process.env.PISTE_HEALTH_MAX_HEARTBEAT_MIN)
  if (Number.isFinite(env) && env > 0) return env
  return mode === 'once' ? 240 : 5
}

export async function GET(request: NextRequest) {
  const ctx = await getCtx()
  const { db, now, mode } = ctx
  const headers = { 'cache-control': 'no-store' }

  if (mode === 'demo') {
    return Response.json(
      {
        ok: true,
        mode,
        now,
        demo: true,
        scheduler: null,
        notes: ['Demo mode: simulated data at a fixed instant. No refresh runs against demo data.'],
      },
      { headers },
    )
  }

  const heartbeat = await getMeta(db, HEARTBEAT_KEY)
  const schedulerMode = await getMeta(db, 'scheduler.mode')
  const ageMinutes = heartbeat ? Math.round(hoursBetween(heartbeat, now) * 60) : null
  const staleAfter = staleAfterMinutes(schedulerMode)
  const stale = ageMinutes === null || ageMinutes > staleAfter

  const lastSuccessByJob: Record<string, string | null> = {}
  const lastRuns: Record<string, { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null> = {}
  for (const job of JOB_NAMES) {
    if (job !== 'reports') lastSuccessByJob[job] = await lastSuccess(db, job)
    const r = (await db.select().from(refreshRuns).where(eq(refreshRuns.job, job)).orderBy(desc(refreshRuns.startedAt), desc(refreshRuns.id)).limit(1))[0]
    lastRuns[job] = r ? { status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error } : null
  }
  const reports: Record<string, string | null> = {}
  for (const p of reportProviders) reports[p.resortId] = await lastSuccess(db, 'reports', p.resortId)

  const body = {
    ok: !stale,
    mode,
    now,
    scheduler: {
      heartbeat,
      mode: schedulerMode,
      ageMinutes,
      staleAfterMinutes: staleAfter,
      stale,
      startedAt: await getMeta(db, 'scheduler.startedAt'),
      stoppedAt: await getMeta(db, 'scheduler.stoppedAt'),
    },
    lastSuccess: { ...lastSuccessByJob, reports },
    lastRuns,
    notes: stale
      ? [
          heartbeat
            ? `No scheduler heartbeat for ${ageMinutes} min. A sleeping machine cannot collect data — run \`npm run worker\` on an always-on host or \`npm run refresh\` from cron.`
            : 'The scheduler has never run. Start `npm run worker`, or call `npm run refresh` from cron.',
        ]
      : [],
  }
  const strict = request.nextUrl.searchParams.get('strict') === '1'
  return Response.json(body, { status: strict && stale ? 503 : 200, headers })
}
