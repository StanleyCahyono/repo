import { Skeleton } from '@/components/ui/states'
import { LoadingHead } from '@/components/explore/loading-head'

/** Explore skeleton: header, then the map stage with its results rail (desktop) or map + rows (phones). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading resorts">
      <LoadingHead titleWidth="w-52" />
      <div className="relative h-[340px] overflow-hidden rounded-[24px] border border-[var(--glass-edge)] bg-[color-mix(in_srgb,var(--teal)_7%,var(--surface-2))] lg:h-[calc(100dvh-210px)] lg:max-h-[1000px] lg:min-h-[640px] lg:rounded-[32px]">
        <Skeleton className="absolute top-4 left-1/2 h-12 w-[min(560px,80%)] -translate-x-1/2 rounded-full lg:left-[calc(50%-216px)]" />
        <div className="glass-strong absolute top-3 right-3 bottom-3 hidden w-[408px] flex-col gap-3 rounded-[26px] p-4 lg:flex">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full rounded-full" />
          <Skeleton className="h-8 w-3/4 rounded-full" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[18px]" />
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 lg:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-[18px]" />
        ))}
      </div>
    </div>
  )
}
