import { Skeleton } from '@/components/ui/states'

/** Designed loading state: the page's real Glass HUD structure in skeleton form (no spinner, no layout jump). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the forecast" className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-col gap-3 pt-2 md:pt-4">
        <p className="hud m-0 tracking-[0.16em] text-teal">Forecast · modeled, not observed</p>
        <Skeleton className="h-[44px] w-[min(640px,90%)] rounded-[14px] md:h-[64px]" />
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="mt-2 h-[50px] w-[min(360px,100%)] rounded-full" />
      </div>
      <Skeleton className="h-[64px] w-full rounded-[24px]" />
      <div className="glass flex flex-col gap-4 rounded-[28px] px-4 py-5 md:rounded-[32px] md:px-6 md:py-6" aria-hidden>
        <Skeleton className="h-5 w-64" />
        <div className="grid h-[260px] grid-cols-16 items-end gap-1.5 md:h-[300px]">
          {Array.from({ length: 16 }, (_, i) => (
            <Skeleton key={i} className="h-[30%] rounded-t-[8px]" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-6" aria-hidden>
        <Skeleton className="h-[300px] w-full rounded-[28px]" />
        <Skeleton className="h-[520px] w-full rounded-[28px]" />
      </div>
    </div>
  )
}
