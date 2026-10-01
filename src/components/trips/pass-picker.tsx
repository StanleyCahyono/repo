'use client'
/**
 * Choose a pass product to check against the trip's ski days ("what if"). The choice lives in the URL (?pass=) so a
 * reload or a return from a resort page restores it. Your owned products are listed first.
 */
import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { Select } from '@/components/ui/form'
import type { PassChoice } from '@/lib/data/trip-plan'

export function PassPicker({ products, chosen }: { products: PassChoice[]; chosen: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const owned = products.filter((p) => p.owned)
  const families = [...new Set(products.filter((p) => !p.owned).map((p) => p.familyName))]
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="trip-pass-check" className="text-[13px] font-medium whitespace-nowrap text-ink-2">
        Check a pass
      </label>
      <Select
        id="trip-pass-check"
        value={chosen ?? ''}
        className="h-10 w-[min(62vw,240px)] text-[14px] md:h-9"
        onChange={(e) => {
          const next = new URLSearchParams(params.toString())
          if (e.target.value) next.set('pass', e.target.value)
          else next.delete('pass')
          const qs = next.toString()
          start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
        }}
      >
        <option value="">{owned.length ? 'Only my passes' : 'None (no pass on file)'}</option>
        {owned.length ? (
          <optgroup label="My passes">
            {owned.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {families.map((f) => (
          <optgroup key={f} label={f}>
            {products
              .filter((p) => !p.owned && p.familyName === f)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
      {pending ? <LoaderCircle aria-label="Checking" className="size-4 animate-spin text-ink-3" /> : null}
    </div>
  )
}
