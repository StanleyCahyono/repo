/**
 * Long-running refresh worker. Usage: npm run worker
 *
 * Runs due jobs on their cadences (see docs/scheduler.md), writes a heartbeat every tick, and stops gracefully on
 * SIGINT/SIGTERM after the current job finishes (a second signal forces exit). Live database only — demo data is
 * never refreshed from live sources. A sleeping machine collects nothing: run this on an always-on host, or use
 * `npm run refresh` from cron instead.
 */
import './_env'
import { closeAll, dbFile, getDb } from '../src/lib/db/client'
import { nowFor } from '../src/lib/clock'
import { defaultDeps } from '../src/lib/jobs/deps'
import { cadencesFromEnv, runWorker } from '../src/lib/jobs/schedule'

async function main() {
  const log = (line: string) => console.log(line)
  const db = await getDb('live')
  const cadences = cadencesFromEnv()
  const deps = defaultDeps({ log })
  const ac = new AbortController()
  const stop = (signal: string) => {
    if (ac.signal.aborted) {
      console.error(`${signal} again — exiting immediately`)
      process.exit(130)
    }
    console.log(`${signal} received — finishing the current job, then stopping…`)
    ac.abort()
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  console.log(`Piste worker — ${dbFile('live')}`)
  console.log(
    `Cadences (min): weather ${cadences.weatherMin}, alerts ${cadences.nwsAlertsMin}, reports ${cadences.reportsDayMin} (${cadences.reportsDayStart}–${cadences.reportsDayEnd} resort time) / ${cadences.reportsNightMin}, assessments ${cadences.assessmentsMin}, links ${cadences.linksMin}, fx ${cadences.fxMin}, prune ${cadences.pruneMin}; tick ${cadences.tickSeconds}s, jitter ±${Math.round(cadences.jitterPct * 100)}%`,
  )
  console.log(`Providers: weather [${deps.weatherProviders.map((p) => p.id).join(', ')}], reports [${deps.reportProviders.map((p) => p.id).join(', ')}], alerts ${deps.alertsProvider?.id ?? 'none'}, fx ${deps.fxProvider?.id ?? 'none'}`)

  await runWorker({ db, deps, cadences, clock: () => nowFor('live'), signal: ac.signal, log })
  await closeAll()
  console.log('Worker stopped.')
}

main().catch(async (e) => {
  console.error(e)
  await closeAll()
  process.exit(1)
})
