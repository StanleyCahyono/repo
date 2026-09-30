/**
 * Real provider wiring for the worker, cron pass and API routes. Tests inject fakes instead (JobDeps).
 * Providers disabled with PISTE_DISABLED_PROVIDERS are left out. The demo database never gets live providers.
 */
import { checkLink } from '@/lib/providers/links'
import { alertsProvider, fxProvider, isProviderEnabled, reportProviders, skiAreaProvider, weatherProviders } from '@/lib/providers/registry'
import { emptyDeps, type JobDeps } from './types'

export function defaultDeps(opts: { demo?: boolean; log?: (line: string) => void; env?: Record<string, string | undefined> } = {}): JobDeps {
  if (opts.demo) return emptyDeps({ demo: true, log: opts.log })
  const env = opts.env ?? process.env
  const on = (id: string) => isProviderEnabled(id, env)
  return {
    weatherProviders: weatherProviders.filter((p) => on(p.id)),
    alertsProvider: on(alertsProvider.id) ? alertsProvider : null,
    fxProvider: on(fxProvider.id) ? fxProvider : null,
    reportProviders: reportProviders.filter((p) => on(p.id)),
    osmProvider: on(skiAreaProvider.id) ? skiAreaProvider : null,
    checkLink: on('link-check') ? (url) => checkLink(url) : null,
    demo: false,
    log: opts.log,
  }
}
