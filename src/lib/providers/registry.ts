/**
 * Provider registry: which adapters exist, in what order they are used, and their connector state for the
 * Sources & Sync page. State describes configuration/maturity only — whether a connector actually succeeded
 * recently comes from refresh runs and source records, never from this list.
 *
 * States
 * - live: implemented against a documented API; runs at request time with no further setup.
 * - needs-credentials: optional connector whose credential is not set; nothing is called.
 * - unverified: adapter written without access to the live source (parser may fail with 'schema-changed').
 * - disabled: turned off with PISTE_DISABLED_PROVIDERS (comma-separated ids).
 */
import { frankfurterProvider } from './fx/frankfurter'
import { duffelProvider } from './flights/duffel'
import { OVERPASS_ENDPOINT, overpassProvider } from './osm/overpass'
import { reportProviders } from './reports'
import type { AlertsProvider, FxProvider, ResortReportProvider, SkiAreaProvider, TravelProvider, WeatherPointRequest, WeatherProvider } from './types'
import { nwsAlertsProvider, nwsGridWeatherProvider } from './weather/nws'
import { openMeteoProvider } from './weather/open-meteo'

export { reportProviders, getReportProvider } from './reports'

/** Primary first. NWS is a second model for disagreement checks (US only). */
export const weatherProviders: WeatherProvider[] = [openMeteoProvider, nwsGridWeatherProvider]
export const alertsProvider: AlertsProvider = nwsAlertsProvider
export const fxProvider: FxProvider = frankfurterProvider
export const travelProvider: TravelProvider = duffelProvider
/** OpenStreetMap lifts and runs (community map data, never live status). */
export const skiAreaProvider: SkiAreaProvider = overpassProvider

export type ConnectorState = 'live' | 'needs-credentials' | 'unverified' | 'disabled'
export type ConnectorRole = 'weather' | 'alerts' | 'resort-report' | 'lifts-runs' | 'fx' | 'flights' | 'link-check'

export interface ConnectorStatus {
  id: string
  label: string
  role: ConnectorRole
  state: ConnectorState
  auth: 'none' | 'optional-key' | 'token'
  /** Credential present (never the credential itself). */
  credentialSet: boolean
  /** Duffel test token: results are test data. */
  testMode: boolean
  coverage: string
  sourceUrl: string
  resortId: string | null
  envVars: string[]
  notes: string[]
}

type Env = Record<string, string | undefined>

export function disabledProviderIds(env: Env = process.env): Set<string> {
  return new Set(
    (env.PISTE_DISABLED_PROVIDERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function isProviderEnabled(id: string, env: Env = process.env): boolean {
  return !disabledProviderIds(env).has(id)
}

/** Enabled weather providers that cover this point, primary first. */
export function weatherProvidersFor(req: WeatherPointRequest, env: Env = process.env): WeatherProvider[] {
  return weatherProviders.filter((p) => isProviderEnabled(p.id, env) && p.supports(req))
}

export function providerStatus(env: Env = process.env, reports: ResortReportProvider[] = reportProviders): ConnectorStatus[] {
  const disabled = disabledProviderIds(env)
  const set = (k: string) => Boolean(env[k]?.trim())
  const contactNote = set('PISTE_CONTACT') ? [] : ['PISTE_CONTACT is not set; api.weather.gov asks clients to include contact details in the User-Agent.']
  const st = (id: string, s: ConnectorState): ConnectorState => (disabled.has(id) ? 'disabled' : s)
  const duffelToken = env.DUFFEL_ACCESS_TOKEN?.trim() ?? ''

  const list: ConnectorStatus[] = [
    {
      id: 'open-meteo',
      label: 'Open-Meteo forecast',
      role: 'weather',
      state: st('open-meteo', 'live'),
      auth: 'optional-key',
      credentialSet: set('OPEN_METEO_API_KEY'),
      testMode: false,
      coverage: 'Worldwide hourly model forecast, 16 days ahead + up to 92 past days; base and summit points.',
      sourceUrl: 'https://open-meteo.com/en/docs',
      resortId: null,
      envVars: ['OPEN_METEO_API_KEY'],
      notes: [
        'Modeled, not observed. Free tier is for non-commercial use; attribution required (CC BY 4.0).',
        set('OPEN_METEO_API_KEY') ? 'Using the customer API with your key.' : 'Using the free API (no key).',
      ],
    },
    {
      id: 'nws-grid',
      label: 'NWS gridded forecast',
      role: 'weather',
      state: st('nws-grid', 'live'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'US resorts only; ~7 days; second model for disagreement checks.',
      sourceUrl: 'https://www.weather.gov/documentation/services-web-api',
      resortId: null,
      envVars: ['PISTE_CONTACT'],
      notes: ['Interval totals are spread evenly over their hours.', ...contactNote],
    },
    {
      id: 'nws-alerts',
      label: 'NWS active alerts',
      role: 'alerts',
      state: st('nws-alerts', 'live'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'Official watches/warnings/advisories for US points.',
      sourceUrl: 'https://www.weather.gov/documentation/services-web-api',
      resortId: null,
      envVars: ['PISTE_CONTACT'],
      notes: [...contactNote],
    },
    ...reports.map<ConnectorStatus>((r) => ({
      id: r.id,
      label: r.label,
      role: 'resort-report',
      state: st(r.id, r.maturity === 'verified' ? 'live' : 'unverified'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'Official operations/snow report page (label-based parser).',
      sourceUrl: r.url,
      resortId: r.resortId,
      envVars: [],
      notes:
        r.maturity === 'verified'
          ? []
          : ['Built without access to the live page. Expect "layout not recognised" failures until verified; manual report entry works meanwhile.'],
    })),
    {
      id: overpassProvider.id,
      label: 'OpenStreetMap lifts & runs',
      role: 'lifts-runs',
      state: st(overpassProvider.id, 'live'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'Lift and run lists mapped by OpenStreetMap contributors, worldwide: lift types, lengths, capacity; run difficulty and lengths. Weekly for favourites and upcoming trips, on demand for any resort.',
      sourceUrl: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
      resortId: null,
      envVars: ['PISTE_CONTACT'],
      notes: [
        'Community-mapped: may be incomplete or out of date. Never live open/closed status — that is only on the resort’s own site.',
        `Data © OpenStreetMap contributors (ODbL), read through the public Overpass API (${new URL(OVERPASS_ENDPOINT).host}); attribution is shown with every list.`,
        ...contactNote,
      ],
    },
    {
      id: 'frankfurter',
      label: 'Frankfurter FX (ECB)',
      role: 'fx',
      state: st('frankfurter', 'live'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'ECB euro reference rates, one per business day.',
      sourceUrl: 'https://www.frankfurter.app/docs/',
      resortId: null,
      envVars: [],
      notes: ['Informational reference rates, not card/bank transaction rates.'],
    },
    {
      id: 'duffel',
      label: 'Duffel flight offers',
      role: 'flights',
      state: st('duffel', duffelToken ? 'live' : 'needs-credentials'),
      auth: 'token',
      credentialSet: Boolean(duffelToken),
      testMode: duffelToken.startsWith('duffel_test_'),
      coverage: 'On-demand flight offers for airlines Duffel sells; quotes expire.',
      sourceUrl: 'https://duffel.com/docs/api/v2/offer-requests',
      resortId: null,
      envVars: ['DUFFEL_ACCESS_TOKEN'],
      notes: duffelToken
        ? duffelToken.startsWith('duffel_test_')
          ? ['Test token: results are Duffel test data, never real fares.']
          : []
        : ['Not configured: use Google Flights/KAYAK search links and manual itinerary/quote entry.'],
    },
    {
      id: 'link-check',
      label: 'Link checker',
      role: 'link-check',
      state: st('link-check', 'live'),
      auth: 'none',
      credentialSet: false,
      testMode: false,
      coverage: 'Validates catalog and saved links (status, redirects, embeddability).',
      sourceUrl: '',
      resortId: null,
      envVars: [],
      notes: ['User-supplied URLs are checked against private/internal addresses before any request.'],
    },
  ]
  return list
}
