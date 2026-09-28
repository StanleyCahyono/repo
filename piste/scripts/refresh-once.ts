/**
 * One refresh pass for cron. Usage:
 *   npm run refresh                          # every job once, in order
 *   npm run refresh -- --jobs weather,reports
 *
 * Exits 1 when any job ended in 'error' (partial failures exit 0 and are listed), so cron can mail you.
 * Example crontab lines are in docs/scheduler.md.
 */
import './_env'
import { closeAll, dbFile, getDb } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { defaultDeps } from '../src/lib/jobs/deps'
import { runOnce, ONCE_ORDER } from '../src/lib/jobs/schedule'
import { JOB_NAMES, type JobName } from '../src/lib/jobs/types'
import { parseArgs } from './_args'

async function main() {
  const args = parseArgs(process.argv.slice(2), ['jobs'])
  const requested = args.values.get('jobs')?.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = requested?.filter((j) => !(JOB_NAMES as readonly string[]).includes(j)) ?? []
  if (unknown.length) {
    console.error(`Unknown job(s): ${unknown.join(', ')}. Known: ${JOB_NAMES.join(', ')}`)
    process.exit(2)
  }
  const jobs = (requested as JobName[] | undefined) ?? ONCE_ORDER
  const db = await getDb('live')
  const ac = new AbortController()
  process.on('SIGINT', () => ac.abort())
  process.on('SIGTERM', () => ac.abort())
  console.log(`Piste refresh — ${dbFile('live')} — ${nowFor('live')}`)
  const out = await runOnce({ db, deps: defaultDeps(), clock: () => nowFor('live'), jobs, signal: ac.signal, log: (l) => console.log(l) })
  await closeAll()
  const errors = out.filter((s) => s.status === 'error')
  console.log(`Done: ${out.length} runs, ${out.filter((s) => s.status === 'ok').length} ok, ${out.filter((s) => s.status === 'partial').length} partial, ${errors.length} error.`)
  process.exit(errors.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await closeAll()
  process.exit(1)
})
