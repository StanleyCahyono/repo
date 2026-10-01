/**
 * "From your gear locker" above the trip checklist: what to pack (gear you own, from My Season) and what you'd still
 * rent there. An empty locker says so — nothing is assumed owned.
 */
import Link from 'next/link'
import { Backpack } from 'lucide-react'
import type { GearCoverage } from '@/lib/domain/gear'

export function GearPacking({ gear }: { gear: GearCoverage }) {
  return (
    <div className="glass-soft mb-4 flex flex-col gap-2.5 rounded-[18px] px-4 py-3.5">
      <p className="hud m-0 flex items-center gap-2 text-ink-2">
        <Backpack aria-hidden className="size-4" /> From your gear locker
      </p>
      {gear.empty ? (
        <p className="m-0 text-[14px] text-ink-2">
          Your locker is empty, so this trip counts all hard goods as rental.{' '}
          <Link href="/season#gear" className="font-medium text-teal">
            Add gear in My Season →
          </Link>
        </p>
      ) : (
        <>
          {gear.packing.length ? (
            <ul className="m-0 flex flex-wrap gap-2 p-0" aria-label="Pack">
              {gear.packing.map((p) => (
                <li key={p.label} className="glass-strong list-none rounded-full px-3 py-1.5 text-[13px] text-ink">
                  {p.label}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="m-0 text-[13px] text-ink-2">
            {gear.toRent.length ? `Rent there: ${gear.toRent.join(', ')}.` : 'Nothing to rent — you own the hard goods.'} {gear.rentalNote}
          </p>
        </>
      )}
    </div>
  )
}
