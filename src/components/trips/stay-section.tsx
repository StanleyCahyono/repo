/**
 * 03 Stay — lodging options saved to the trip (your prices, labelled private; per-night derived from your number),
 * a comparison when there are several options, and the catalog's curated hotels for the trip's resorts to save as
 * ideas ("Check rates" — Piste has no sourced room rates). Ski-in/ski-out is shown only when verified.
 */
import { ArrowUpRight, BedDouble } from 'lucide-react'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { HotelOption, TripPage } from '@/lib/data/trip-plan'
import type { TripItemRow } from '@/lib/db/rows'
import { money } from '@/lib/domain/money'
import { ConfirmTag, EmptySlot, SubHead, TripSection, CostKindTag, PrivateTag } from './bits'
import { TIER_LABEL, hostOf, itemCost, nights, plural, rangeText, spanLabel } from './format'
import { AddItemButton, QuickAdd } from './add-buttons'
import { ItemRow } from './item-row'

const SKI_IN_OUT: Record<HotelOption['skiInOut'], string> = {
  'verified-yes': 'Ski-in/ski-out (verified)',
  'verified-no': 'Not ski-in/ski-out (verified)',
  unknown: 'Ski-in/ski-out not verified',
}

function perNight(item: TripItemRow): string | null {
  const c = itemCost(item)
  const n = nights(item.date, item.endDate)
  if (!c || !n) return null
  const each = (m: { amountMinor: number; currency: string }) => money(Math.round(m.amountMinor / n), m.currency)
  const min = each(c.range.min)
  const max = each(c.range.max)
  return `${rangeText({ min, max })} per night`
}

export function StaySection({ page, index }: { page: TripPage; index: number }) {
  const lodging = page.detail.items.filter((i) => i.type === 'lodging')
  const hotelById = new Map(page.hotels.map((h) => [h.id, h]))
  const unsaved = page.hotels.filter((h) => h.savedItemId === null)
  const byResort = [...new Set(unsaved.map((h) => h.resortId))]
  const nightsTotal = Math.max(0, page.days.length - 1)
  const checkOut = page.trip.endDate > page.trip.startDate ? page.trip.endDate : undefined

  return (
    <TripSection
      id="stay"
      index={index}
      title="Stay"
      meta={nightsTotal ? `${plural(nightsTotal, 'night')} · party of ${page.trip.partySize}` : 'Day trip — no nights'}
      actions={
        <AddItemButton type="lodging" defaults={{ date: page.trip.startDate, endDate: checkOut }}>
          Your own lodging
        </AddItemButton>
      }
    >
      <div className="flex flex-col gap-8">
        {lodging.length ? (
          <div className="flex flex-col gap-3">
            {lodging.map((l) => {
              const h = l.refId ? hotelById.get(l.refId) : undefined
              const url = (typeof l.details?.url === 'string' ? l.details.url : null) ?? h?.officialUrl ?? null
              const pn = perNight(l)
              const n = nights(l.date, l.endDate)
              return (
                <article key={l.id} className="rounded-[12px] border border-divider bg-surface p-1.5">
                  <ItemRow item={l} />
                  <div className="mx-2 mb-2 grid gap-x-6 gap-y-1.5 border-t border-divider px-1 pt-3 text-[13px] sm:grid-cols-2 md:mx-3">
                    <p className="text-ink-2 tnum">
                      {spanLabel(l.date, l.endDate) ?? <Missing label="Dates not set" />}
                      {n ? ` · ${plural(n, 'night')}` : ''}
                    </p>
                    <p className="text-ink-2 sm:text-right">{pn ? <span className="tnum">≈ {pn}, from your price</span> : l.costMinor == null ? <span className="text-ink-3 italic">Check rates — no price recorded</span> : null}</p>
                    {h ? (
                      <>
                        <p className="text-ink-2">
                          {h.tier ? `${TIER_LABEL[h.tier]} · ` : ''}
                          {SKI_IN_OUT[h.skiInOut]}
                        </p>
                        <p className="text-ink-3 sm:text-right">{h.resortName}</p>
                        {h.distanceText ? <p className="text-[12.5px] text-ink-3 sm:col-span-2">{h.distanceText}</p> : null}
                      </>
                    ) : (
                      <p className="sm:col-span-2">
                        <PrivateTag label="Your own lodging entry · private" />
                      </p>
                    )}
                    {url ? (
                      <p className="sm:col-span-2">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
                          Check rates at {hostOf(url)} <ArrowUpRight aria-hidden className="size-3.5" />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </p>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptySlot
            title={nightsTotal ? 'No lodging yet' : 'A day trip needs no lodging'}
            body={nightsTotal ? 'Save a curated option below as an idea, or add your own with the price you were quoted.' : 'Change the trip dates to add nights.'}
          />
        )}

        {lodging.length > 1 ? <Comparison lodging={lodging} /> : null}

        {byResort.length ? (
          <section aria-labelledby="hotels-title">
            <SubHead id="hotels-title" aside="Curated catalog · no sourced room rates">
              Options on file
            </SubHead>
            <div className="flex flex-col gap-5">
              {byResort.map((rid) => {
                const list = unsaved.filter((h) => h.resortId === rid)
                return (
                  <div key={rid}>
                    {byResort.length > 1 ? <p className="mb-2 text-[13px] font-semibold text-ink-2">{list[0].resortName}</p> : null}
                    <ul className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
                      {list.map((h) => (
                        <li key={h.id} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div className="flex min-w-0 gap-3">
                            <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-divider bg-surface-2 text-ink-2">
                              <BedDouble className="size-4" strokeWidth={1.8} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[14.5px] font-medium text-ink">
                                {h.name}
                                {h.tier ? <span className="ml-2 inline-flex h-5 items-center rounded-sm border border-divider px-1.5 align-middle text-[11.5px] font-medium text-ink-2">{TIER_LABEL[h.tier]}</span> : null}
                              </p>
                              {h.distanceText ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{h.distanceText}</p> : null}
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                                <span className="text-ink-3">{SKI_IN_OUT[h.skiInOut]}</span>
                                {h.officialUrl ? (
                                  <a href={h.officialUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal hover:underline">
                                    Check rates<span className="sr-only"> at {h.name} (opens in a new tab)</span>
                                  </a>
                                ) : (
                                  <Missing label="No official link on file" className="text-[12.5px]" />
                                )}
                                {h.prov?.verification === 'search-summary' || h.prov?.verification === 'unverified' ? <ConfirmTag /> : null}
                                {h.prov ? <SourceDrawer title={h.name} items={[{ label: h.name, value: h.distanceText ?? undefined, prov: h.prov }]} /> : null}
                              </div>
                            </div>
                          </div>
                          <QuickAdd label="Save as option" input={{ type: 'lodging', refId: h.id, status: 'idea' }} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </TripSection>
  )
}

/** Side-by-side comparison of saved lodging options (your prices; unknown stays unknown). */
function Comparison({ lodging }: { lodging: TripItemRow[] }) {
  return (
    <section aria-labelledby="compare-stay">
      <SubHead id="compare-stay">Compare options</SubHead>
      <div className="relative overflow-x-auto rounded-[12px] border border-divider bg-surface">
        <table className="w-full min-w-[560px] text-[13.5px]">
          <caption className="sr-only">Saved lodging options compared</caption>
          <thead>
            <tr className="border-b border-divider bg-surface-2 text-left text-[12px] text-ink-3">
              <th scope="col" className="px-4 py-2 font-medium">Option</th>
              <th scope="col" className="px-3 py-2 font-medium">Nights</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Your price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Per night</th>
              <th scope="col" className="px-4 py-2 font-medium">Kind</th>
            </tr>
          </thead>
          <tbody>
            {lodging.map((l) => {
              const c = itemCost(l)
              const n = nights(l.date, l.endDate)
              return (
                <tr key={l.id} className="border-b border-divider last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink">
                    {l.title}
                  </th>
                  <td className="px-3 py-2.5 tnum">{n ?? <Missing />}</td>
                  <td className="px-3 py-2.5 text-right tnum">{c ? `${rangeText(c.range)}${c.basis === 'shared' ? '' : ' pp'}` : <Missing label="Check rates" />}</td>
                  <td className="px-3 py-2.5 text-right tnum">{c && n ? rangeText({ min: money(Math.round(c.range.min.amountMinor / n), c.range.min.currency), max: money(Math.round(c.range.max.amountMinor / n), c.range.max.currency) }) : <Missing />}</td>
                  <td className="px-4 py-2.5">{c ? <CostKindTag kind={c.kind} short /> : <span className="text-ink-3">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-ink-3">Per-night figures divide your own price by the nights; they are not room rates from any source.</p>
    </section>
  )
}
