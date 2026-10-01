import { Skeleton } from '@/components/ui/states'

/** My Season skeleton: header, figures strip, timeline, section bar and a few journal entries beside the aside. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading your season…</p>
      <Skeleton className="h-3 w-56" />
      <Skeleton className="mt-3 h-10 w-48" />
      <Skeleton className="mt-3 h-4 w-[min(560px,90%)]" />
      <div className="mt-8 grid grid-cols-2 gap-6 border-y border-divider py-4 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((k) => (
          <div key={k}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-[168px] w-full rounded-[12px]" />
      <Skeleton className="mt-10 h-10 w-[min(520px,100%)]" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-36 w-full rounded-[12px]" />
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 w-full rounded-[12px]" />
          <Skeleton className="h-64 w-full rounded-[12px]" />
        </div>
      </div>
    </div>
  )
}
