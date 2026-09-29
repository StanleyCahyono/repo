/**
 * Duffel flight offers (https://duffel.com/docs/api/v2/offer-requests), optional and credential-gated.
 *
 * POST https://api.duffel.com/air/offer_requests?return_offers=true with `Authorization: Bearer <token>`,
 * `Duffel-Version: v2`, JSON in/out. Only runs when DUFFEL_ACCESS_TOKEN is set; otherwise every call returns
 * errorKind 'not-configured' WITHOUT touching the network.
 *
 * - Test tokens (`duffel_test_…`) or `live_mode: false` responses are marked `testMode` — never presented as fares.
 * - `total_amount` is a decimal string → integer minor units via money.ts (no floats).
 * - Segment times are airport-LOCAL wall times without offset; converted to UTC only when Duffel supplies the
 *   airport `time_zone`, and the local wall time is kept alongside.
 * - Offers expire (`expires_at`); callers must show the quote retrieval time and expiry.
 * - Ski/sports-equipment fees are not part of Duffel offers; baggage notes list included bags only, as the minimum
 *   across segments (never overstated).
 */
import { DateTime } from 'luxon'
import { z } from 'zod'
import { fromMajor } from '@/lib/domain/money'
import { provenance } from '@/lib/domain/types'
import { defaultHttp, type HttpClient } from '../http'
import { caps, describeIssues, fail, failFromHttp, toUtcIso } from '../result'
import type { FlightOffer, FlightOfferQuery, ProviderResult, TravelProvider } from '../types'

export const DUFFEL_OFFER_REQUESTS_URL = 'https://api.duffel.com/air/offer_requests?return_offers=true'
const IATA = /^[A-Z]{3}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const Place = z.object({ iata_code: z.string().nullable().optional(), time_zone: z.string().nullable().optional() })
const Carrier = z.object({ iata_code: z.string().nullable().optional(), name: z.string().nullable().optional() })

const Segment = z.object({
  origin: Place,
  destination: Place,
  departing_at: z.string(),
  arriving_at: z.string(),
  marketing_carrier: Carrier,
  marketing_carrier_flight_number: z.string(),
  operating_carrier: Carrier.nullable().optional(),
  passengers: z
    .array(z.object({ baggages: z.array(z.object({ type: z.string(), quantity: z.number() })).optional() }))
    .optional(),
})

const Offer = z.object({
  id: z.string(),
  total_amount: z.string().regex(/^\d+(\.\d+)?$/),
  total_currency: z.string().regex(IATA),
  expires_at: z.string().nullable().optional(),
  live_mode: z.boolean().optional(),
  owner: Carrier.nullable().optional(),
  slices: z.array(z.object({ origin: Place, destination: Place, segments: z.array(Segment).min(1) })).min(1),
})

const ResponseSchema = z.object({
  data: z.object({ id: z.string().optional(), live_mode: z.boolean().optional(), offers: z.array(Offer) }),
})

const ErrorSchema = z.object({ errors: z.array(z.object({ title: z.string().optional(), message: z.string().optional(), code: z.string().optional() })) })

function localToUtc(local: string, zone: string | null | undefined): string | null {
  if (!zone) return null
  const dt = DateTime.fromISO(local, { zone })
  return dt.isValid ? dt.toUTC().toISO() : null
}

/**
 * Bags included for the first passenger. A bag is only included for the trip when EVERY segment that states
 * baggage includes it, so each type takes the minimum across those segments (a type a stating segment omits counts
 * as 0) — never the maximum, which would overstate what the fare covers. Segments without baggage data are flagged.
 */
function baggageNotes(segments: z.infer<typeof Segment>[]): string | null {
  type Bag = { type: string; quantity: number }
  const stated = segments.map((s) => s.passengers?.[0]?.baggages).filter((b): b is Bag[] => b !== undefined)
  const types = [...new Set(stated.flat().map((b) => b.type))]
  if (types.length === 0) return null
  const parts = types.map((type) => {
    const perSegment = stated.map((bags) => Math.max(0, ...bags.filter((b) => b.type === type).map((b) => b.quantity)))
    return `${Math.min(...perSegment)} ${type.replace(/_/g, '-')}`
  })
  const partial = stated.length < segments.length ? ' Not stated for every segment.' : ''
  return `Included per passenger (first passenger): ${parts.join(', ')}.${partial} Ski/sports-equipment fees not included.`
}

/** Pure normalisation of an offer-request response. Exported for tests. */
export function normalizeDuffelOffers(json: unknown, tokenIsTest: boolean): { ok: true; offers: FlightOffer[]; limitations: string[] } | { ok: false; error: string } {
  const parsed = ResponseSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: describeIssues(parsed.error.issues) }
  const requestTest = parsed.data.data.live_mode === false
  const limitations = new Set<string>()
  const offers: FlightOffer[] = []
  for (const o of parsed.data.data.offers) {
    let unknownZone = false
    const slices = o.slices.map((sl) => {
      const segments = sl.segments.map((s) => {
        const dep = localToUtc(s.departing_at, s.origin.time_zone)
        const arr = localToUtc(s.arriving_at, s.destination.time_zone)
        if (!dep || !arr) unknownZone = true
        return {
          carrier: s.marketing_carrier.iata_code ?? '',
          flightNumber: s.marketing_carrier_flight_number,
          origin: s.origin.iata_code ?? '',
          destination: s.destination.iata_code ?? '',
          departAt: dep ?? s.departing_at,
          arriveAt: arr ?? s.arriving_at,
          departLocal: s.departing_at,
          arriveLocal: s.arriving_at,
          carrierName: s.marketing_carrier.name ?? null,
          operatingCarrier: s.operating_carrier?.iata_code ?? null,
        }
      })
      return {
        origin: sl.origin.iata_code ?? segments[0].origin,
        destination: sl.destination.iata_code ?? segments.at(-1)!.destination,
        departAt: segments[0].departAt,
        arriveAt: segments.at(-1)!.arriveAt,
        segments,
      }
    })
    if (unknownZone) limitations.add('Some segment times are airport-local because Duffel did not supply the airport time zone.')
    offers.push({
      id: o.id,
      totalAmountMinor: fromMajor(o.total_amount, o.total_currency).amountMinor,
      currency: o.total_currency,
      expiresAt: toUtcIso(o.expires_at ?? null),
      owner: o.owner?.name ?? o.owner?.iata_code ?? null,
      slices,
      baggageNotes: baggageNotes(o.slices.flatMap((sl) => sl.segments)),
      testMode: tokenIsTest || requestTest || o.live_mode === false,
    })
  }
  return { ok: true, offers, limitations: [...limitations] }
}

function validQuery(q: FlightOfferQuery): string | null {
  if (!IATA.test(q.origin) || !IATA.test(q.destination)) return 'Origin and destination must be IATA airport codes'
  if (!DATE.test(q.departDate) || (q.returnDate !== null && !DATE.test(q.returnDate))) return 'Dates must be YYYY-MM-DD'
  if (q.returnDate !== null && q.returnDate < q.departDate) return 'Return date is before departure'
  if (!Number.isInteger(q.adults) || q.adults < 1 || q.adults > 9) return 'Adults must be 1–9'
  return null
}

export function createDuffelProvider(options: { http?: HttpClient } = {}): TravelProvider {
  const http = () => options.http ?? defaultHttp
  const token = () => http().env.env().DUFFEL_ACCESS_TOKEN?.trim() || null
  return {
    id: 'duffel',
    configured: () => token() !== null,
    async searchOffers(q): Promise<ProviderResult<FlightOffer[]>> {
      const t = token()
      if (!t) return fail('not-configured', 'Duffel is not configured (set DUFFEL_ACCESS_TOKEN). Use flight-search links or manual quotes.')
      const invalid = validQuery(q)
      if (invalid) return fail('unsupported', invalid)
      const slices = [{ origin: q.origin, destination: q.destination, departure_date: q.departDate }]
      if (q.returnDate) slices.push({ origin: q.destination, destination: q.origin, departure_date: q.returnDate })
      const body = {
        data: { slices, passengers: Array.from({ length: q.adults }, () => ({ type: 'adult' })), cabin_class: q.cabin },
      }
      const res = await http().request(DUFFEL_OFFER_REQUESTS_URL, {
        method: 'POST',
        expect: 'json',
        headers: {
          Authorization: `Bearer ${t}`,
          'Duffel-Version': 'v2',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip',
        },
        body,
        timeoutMs: 60_000,
        retries: 0,
        maxBytes: 20 * 1024 * 1024,
      })
      if (!res.ok) {
        let detail = ''
        if (res.bodySnippet) {
          try {
            const e = ErrorSchema.safeParse(JSON.parse(res.bodySnippet))
            if (e.success && e.data.errors[0]) detail = ` — ${e.data.errors[0].message ?? e.data.errors[0].title ?? ''}`
          } catch {
            /* truncated or non-JSON body */
          }
        }
        if (res.status === 401 || res.status === 403) {
          return fail('http', `Duffel rejected the access token (HTTP ${res.status})${detail}`, [res.fetch], false)
        }
        return failFromHttp({ ...res, error: `${res.error}${detail}` }, [res.fetch], 'Duffel')
      }
      const tokenIsTest = t.startsWith('duffel_test_')
      const norm = normalizeDuffelOffers(res.data, tokenIsTest)
      if (!norm.ok) return fail('parse', `Duffel: ${norm.error}`, [{ ...res.fetch, ok: false, error: norm.error }], false)
      const testMode = tokenIsTest || norm.offers.some((o) => o.testMode)
      const limitations = [
        ...norm.limitations,
        'Offers are quotes that expire; re-check before booking. Coverage is limited to airlines Duffel sells.',
      ]
      if (testMode) limitations.unshift('TEST MODE: Duffel test data — not real fares, schedules or availability.')
      return {
        ok: true,
        data: norm.offers,
        capabilities: caps(['offers'], [], limitations),
        fetches: [{ ...res.fetch, extract: { offers: norm.offers.length, testMode } }],
        provenance: provenance({
          kind: testMode ? 'demo' : 'official',
          provider: testMode ? 'Duffel (test mode)' : 'Duffel',
          sourceUrl: DUFFEL_OFFER_REQUESTS_URL,
          fetchedAt: res.fetch.fetchedAt,
          staleAfter: norm.offers.map((o) => o.expiresAt).filter((e): e is string => e !== null).sort()[0] ?? null,
          verification: 'api',
          note: testMode ? 'Duffel test mode — not real offers.' : null,
        }),
      }
    },
  }
}

export const duffelProvider: TravelProvider = createDuffelProvider()
