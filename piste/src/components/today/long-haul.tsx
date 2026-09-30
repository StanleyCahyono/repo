/**
 * Where Today leaves resorts out for being far away: "Resorts more than a long flight away are planned as trips —
 * see Explore". The distance rule itself is LONG_HAUL_KM (src/lib/domain/geo.ts); `limit` is that distance in the
 * user's units. Server-renderable.
 */
import Link from 'next/link'
import { Plane } from 'lucide-react'
import { LONG_HAUL_KM, LONG_HAUL_NOTE } from '@/lib/domain/geo'
import { cn } from '@/lib/ui/cn'

const LEAD = LONG_HAUL_NOTE.replace(/\s*see Explore$/, ' ')
const KM = `${LONG_HAUL_KM.toLocaleString('en-US')} km`

export function LongHaulNote({ count, names, limit, what, className }: {
  /** Resorts left out. */
  count: number
  /** Their names, when few enough to list (favourites). */
  names?: readonly string[]
  /** LONG_HAUL_KM in display units, e.g. "4,500 km" / "2,796 mi" (default: kilometres). */
  limit?: string | null
  /** What they are left out of, e.g. "ranked here", "shown in this strip". */
  what: string
  className?: string
}) {
  if (count <= 0) return null
  const who = names?.length ? names.join(', ') : `${count} resort${count === 1 ? '' : 's'}`
  const verb = names?.length ? (names.length === 1 ? 'is' : 'are') : count === 1 ? 'is' : 'are'
  return (
    <p className={cn('flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-3', className)}>
      <Plane aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <span className="tnum">{who}</span> — more than {limit ?? KM} from home — {verb} not {what}. {LEAD}
        <Link href="/explore" className="font-medium text-teal hover:underline">
          see Explore
        </Link>
        .
      </span>
    </p>
  )
}
