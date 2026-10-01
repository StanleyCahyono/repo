'use client'
/**
 * Origin airport alternatives: ITH by default, with SYR, ELM, ROC and BUF (your Settings list). Each shows the drive
 * from home (a curated estimate, with the explicit winter buffer), parking as recorded (or not on file), and
 * prefilled SEARCH links — Piste never shows fares or schedules from them. "Use" sets the trip's origin.
 */
import { motion } from 'motion/react'
import { ArrowUpRight, Check } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Missing } from '@/components/ui/provenance'
import { SourceDrawer } from '@/components/ui/source-drawer'
import type { Provenance } from '@/lib/domain/types'
import { flightSearchLinks } from '@/lib/providers/links/builders'
import { updateTrip } from '@/lib/actions/trips'
import { duration, hostOf } from './format'
import { useTripUi } from './trip-ui'

export interface OriginRow {
  iata: string
  name: string | null
  city: string | null
  driveMinutes: number | null
  winterMinutes: number | null
  km: number | null
  basis: string | null
  parking: string | null
  officialUrl: string | null
  prov: Provenance | null
  driveProv: Provenance | null
  routesKnown: boolean
}

export function OriginAirports({ rows, selected, dest, depart, ret, winterPct, homeName }: { rows: OriginRow[]; selected: string; dest: string | null; depart: string; ret: string | null; winterPct: number; homeName: string }) {
  const { data, run, pending } = useTripUi()
  const fastest = rows.filter((r) => r.winterMinutes !== null).sort((a, b) => a.winterMinutes! - b.winterMinutes!)[0]?.iata
  const anyRoutes = rows.some((r) => r.routesKnown)
  return (
    <div role="radiogroup" aria-label="Origin airport for this trip" className="overflow-hidden rounded-[20px] border border-divider bg-surface/70">
      <div aria-hidden className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_104px] gap-4 border-b border-divider bg-surface-2 px-4 py-2 text-[12px] font-semibold tracking-wide text-ink-3 uppercase lg:grid">
        <span>Airport</span>
        <span>Drive, winter</span>
        <span>Parking</span>
        <span className="w-[200px]">{dest ? `Search flights to ${dest}` : 'Search flights'}</span>
        <span className="text-right">Origin</span>
      </div>
      <ul className="divide-y divide-divider">
        {rows.map((r) => {
          const on = r.iata === selected
          const links = dest ? flightSearchLinks({ from: r.iata, to: dest, depart, return: ret }) : []
          return (
            <li key={r.iata} className="relative">
              {on ? <motion.span layoutId="origin-selected" transition={t.select} aria-hidden className="absolute inset-0 border-l-[3px] border-teal bg-glacier/45" /> : null}
              <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_104px]">
                <div className="flex min-w-0 items-center gap-3 lg:order-1">
                  <span className="w-12 shrink-0 font-light tracking-[-0.03em] text-[26px] leading-none text-ink">{r.iata}</span>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[13.5px] leading-snug font-medium text-ink">{r.name ?? r.iata}</p>
                    <p className="text-[12.5px] text-ink-3">
                      {r.iata === 'ITH' ? 'Default origin' : 'Nearby alternative'}
                      {r.iata === fastest && rows.length > 1 && r.iata !== 'ITH' ? ' · closest to home' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end lg:order-5">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={on ? `${r.iata} selected as origin` : `Use ${r.iata} as origin`}
                    disabled={pending || data.status === 'cancelled'}
                    onClick={() => !on && run(() => updateTrip({ tripId: data.tripId, originAirport: r.iata }), { success: `Flying from ${r.iata}` })}
                    className={cn(
                      'inline-flex h-10 min-w-[96px] items-center justify-center gap-1.5 rounded-md border px-3 text-[13.5px] font-medium transition-colors duration-150 md:h-9',
                      on ? 'border-teal bg-surface text-teal' : 'border-divider-strong bg-surface text-ink hover:border-teal hover:text-teal',
                    )}
                  >
                    {on ? <Check aria-hidden className="size-4" /> : null}
                    {on ? 'Selected' : `Use ${r.iata}`}
                  </button>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:contents">
                  <div className="min-w-0 lg:order-2">
                    <p className="text-[12px] text-ink-3 lg:hidden">Drive, winter</p>
                    {r.driveMinutes !== null ? (
                      <>
                        <p className="flex items-center gap-1 text-[14.5px] font-semibold text-ink tnum">
                          {duration(r.winterMinutes)}
                          <SourceDrawer title={`Drive to ${r.iata}`} items={[{ label: `${homeName} → ${r.iata}`, value: r.basis ?? undefined, prov: r.driveProv }]} />
                        </p>
                        <p className="text-[12px] whitespace-nowrap text-ink-3 tnum">
                          {duration(r.driveMinutes)} + {winterPct}%
                        </p>
                      </>
                    ) : (
                      <Missing label="No estimate" />
                    )}
                  </div>
                  <div className="min-w-0 lg:order-3">
                    <p className="text-[12px] text-ink-3 lg:hidden">Parking</p>
                    {r.parking ? <p className="text-[13.5px] text-ink">{r.parking}</p> : <Missing label="Not on file" />}
                    {r.officialUrl ? (
                      <a href={r.officialUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[12.5px] font-medium text-teal hover:underline">
                        {hostOf(r.officialUrl)}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : null}
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-1 lg:order-4 lg:w-[200px]">
                    {links.length ? (
                      links.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" title={l.note} className="inline-flex h-9 items-center gap-1 text-[13px] font-medium whitespace-nowrap text-teal hover:underline">
                          {l.label.replace('Search ', '')}
                          <ArrowUpRight aria-hidden className="size-3.5" />
                          <span className="sr-only"> — search {r.iata} to {dest} (opens in a new tab)</span>
                        </a>
                      ))
                    ) : (
                      <span className="text-[12.5px] text-ink-3">{dest ? 'No search for these dates' : 'Add a destination airport'}</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="border-t border-divider bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink-3">
        {anyRoutes ? '' : 'Airline routes aren’t recorded for these airports — check each airport’s site. '}Search links open Google Flights or KAYAK for your dates; Piste reads no fares, schedules or availability from them — enter what you find as a quote.
      </p>
    </div>
  )
}
