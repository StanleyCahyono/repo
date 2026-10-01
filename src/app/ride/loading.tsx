import { Skeleton } from '@/components/ui/states'

/** Ride there loading: the map stage and the sheet as static blocks. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="relative">
      <p className="sr-only">Loading the journey map…</p>
      <Skeleton className="-mx-4 -mt-6 h-[54svh] min-h-[360px] rounded-none md:mx-0 md:mt-0 md:h-[58vh] md:rounded-[28px] lg:h-[calc(100dvh-140px)] lg:min-h-[640px]" />
      <div className="glass-strong relative z-10 -mx-4 -mt-7 flex flex-col gap-4 rounded-t-[28px] p-5 md:mx-0 md:rounded-[28px] lg:absolute lg:top-4 lg:bottom-4 lg:left-4 lg:mt-0 lg:w-[440px]">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-28 w-full rounded-[20px]" />
        <div className="flex gap-2">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-11 w-24 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-20 w-full rounded-[16px]" />
        <Skeleton className="h-20 w-full rounded-[20px]" />
      </div>
    </div>
  )
}
