'use client'
/**
 * Optional flight offers (Duffel). Only when a connector is configured and in live mode; otherwise a clear
 * "not configured" / "not in demo mode" state that points to the search links and manual quote entry. Offers are
 * quotes that expire: retrieval and expiry times are shown, test-mode data is labelled and cannot be saved as a
 * quote, and nothing is monitored after you leave.
 */
import { useState } from 'react'
import { CircleSlash, FlaskConical, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/states'
import { cn } from '@/lib/ui/cn'
import { formatMoney, money } from '@/lib/domain/money'
import { relativeLabel } from '@/lib/domain/time'
import { addTripItem, fetchFlightOffers, type FlightOffersResult } from '@/lib/actions/trips'
import { majorString, spanLabel } from './format'
import { useTripUi } from './trip-ui'

type State = 'live' | 'needs-credentials' | 'disabled' | 'demo'

export function FlightOffers({ state, testMode, origin, dest, depart, ret, adults }: { state: State; testMode: boolean; origin: string; dest: string | null; depart: string; ret: string | null; adults: number }) {
  const { data, run, pending } = useTripUi()
  const [result, setResult] = useState<FlightOffersResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (state !== 'live') {
    const copy =
      state === 'demo'
        ? { Icon: FlaskConical, title: 'Flight offers are not fetched in demo mode', body: 'Demo trips never call a live connector. Use the search links and enter a quote by hand.' }
        : state === 'disabled'
          ? { Icon: CircleSlash, title: 'Flight offers connector is disabled', body: 'It is switched off on this server (PISTE_DISABLED_PROVIDERS). Use the search links and manual quotes.' }
          : {
              Icon: PlugZap,
              title: 'Live flight offers: not configured',
              body: 'Piste can request quotes from Duffel when DUFFEL_ACCESS_TOKEN is set on the server. Until then there are no fares, schedules or price monitoring here — use the search links above and enter your itinerary and quote by hand.',
            }
    return (
      <div className="flex gap-3 rounded-[12px] border border-dashed border-divider-strong bg-surface-2 px-4 py-3.5">
        <copy.Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">{copy.title}</p>
          <p className="mt-0.5 text-[13px] text-ink-2">{copy.body}</p>
        </div>
      </div>
    )
  }

  const fetchOffers = () => {
    if (!dest) return
    setError(null)
    run(() => fetchFlightOffers({ tripId: data.tripId, origin, destination: dest, departDate: depart, returnDate: ret, adults }), {
      success: false,
      onDone: (r) => setResult(r),
      onError: (r) => setError(r.error),
    })
  }

  return (
    <div className="rounded-[12px] border border-divider bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">Flight offers (Duffel)</p>
          <p className="text-[12.5px] text-ink-3">
            {origin} → {dest ?? '—'} · {spanLabel(depart, ret)} · {adults} adult{adults === 1 ? '' : 's'}
            {testMode ? ' · test token' : ''}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="h-10 md:h-8" disabled={pending || !dest} onClick={fetchOffers}>
          <RefreshCw aria-hidden className={cn('size-4', pending && 'animate-spin')} />
          {result ? 'Refresh offers' : 'Get offers'}
        </Button>
      </div>
      {error ? <Notice tone="error" title={error} className="m-3" /> : null}
      {result ? (
        <div className="px-4 py-3">
          {result.testMode ? (
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-sm bg-demo-bg px-2 py-1 text-[12.5px] font-semibold text-demo">
              <FlaskConical aria-hidden className="size-3.5" /> TEST MODE — not real fares, schedules or availability
            </p>
          ) : null}
          <p className="text-[12.5px] text-ink-3">
            Retrieved {result.fetchedAt ? relativeLabel(result.fetchedAt, new Date().toISOString()) : 'just now'} from {result.provider}. {result.limitations.join(' ')}
          </p>
          {result.offers.length ? (
            <ul className="mt-2 divide-y divide-divider">
              {result.offers.map((o) => {
                const out = o.slices[0]
                const segs = out?.segments ?? []
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink tnum">
                        {formatMoney(money(o.totalAmountMinor, o.currency))} <span className="text-[12.5px] font-normal text-ink-3">total, {adults} adult{adults === 1 ? '' : 's'}</span>
                      </p>
                      <p className="text-[12.5px] text-ink-2 tnum">
                        {o.owner ?? 'Airline'} · {segs.map((x) => `${x.carrier}${x.flightNumber}`).join(' + ')} · {segs.length - 1 ? `${segs.length - 1} connection${segs.length > 2 ? 's' : ''}` : 'nonstop'}
                      </p>
                      <p className="text-[12px] text-ink-3">{o.expiresAt ? `Quote expires ${relativeLabel(o.expiresAt, new Date().toISOString())}` : 'Expiry not stated'}{o.baggageNotes ? ` · ${o.baggageNotes}` : ''}</p>
                    </div>
                    {result.testMode ? (
                      <span className="text-[12.5px] text-ink-3">Test data — not saved</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-10 md:h-8"
                        onClick={() =>
                          run(() =>
                            addTripItem({
                              tripId: data.tripId,
                              type: 'flight',
                              refId: dest,
                              title: `Flights ${origin} ⇄ ${dest} (${o.owner ?? 'offer'})`,
                              date: depart,
                              endDate: ret,
                              status: 'draft',
                              cost: { min: majorString(o.totalAmountMinor, o.currency), currency: o.currency, kind: 'quote', basis: 'shared', quoteExpiresAt: o.expiresAt ? o.expiresAt.slice(0, 10) : null },
                              details: {
                                origin,
                                ticketing: 'single',
                                fareNotes: o.baggageNotes,
                                segments: segs.map((x) => ({ carrier: x.carrier, flightNumber: x.flightNumber, from: x.origin, to: x.destination, departLocal: (x.departLocal ?? '').slice(0, 16) || null, arriveLocal: (x.arriveLocal ?? '').slice(0, 16) || null })),
                                note: `Duffel quote for ${adults} adult${adults === 1 ? '' : 's'}; it expires — re-check before booking.`,
                              },
                            }),
                          )
                        }
                      >
                        Save as quote
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13.5px] text-ink-2">No offers returned for these dates.</p>
          )}
        </div>
      ) : (
        <p className="px-4 py-3 text-[13px] text-ink-2">Fetched only when you ask. Offers are quotes that expire; Piste does not monitor prices.</p>
      )}
    </div>
  )
}
