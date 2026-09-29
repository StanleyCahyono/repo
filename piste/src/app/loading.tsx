import { Skeleton } from '@/components/ui/states'

/**
 * App-wide loading state (Today and any screen without its own loading.tsx): the editorial page skeleton — eyebrow,
 * title, lead and controls, then a main panel beside a side column. Static blocks (no shimmer sweep), announced once.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading…</p>
      <Skeleton className="h-3 w-52" />
      <Skeleton className="mt-3 h-9 w-36 md:h-11" />
      <Skeleton className="mt-3 h-4 w-[min(560px,90%)]" />
      <div className="mt-5 flex gap-2 overflow-hidden">
        {['w-[88px]', 'w-[104px]', 'w-[150px]', 'w-[112px]'].map((w) => (
          <Skeleton key={w} className={`h-11 shrink-0 rounded-full md:h-10 ${w}`} />
        ))}
      </div>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-[14px] border border-divider bg-surface px-4 pt-5 pb-6 md:px-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-4 h-4 w-48" />
          <Skeleton className="mt-3 h-10 w-[min(360px,80%)]" />
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {[0, 1].map((k) => (
              <div key={k} className="flex flex-col gap-2.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {[0, 1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-3 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div className="rounded-[12px] border border-divider bg-surface p-4">
            <Skeleton className="h-3 w-32" />
            <div className="mt-4 grid grid-cols-7 gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                <Skeleton key={k} className="h-12" />
              ))}
            </div>
          </div>
          <div className="rounded-[12px] border border-divider bg-surface p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-24 w-full" />
            <Skeleton className="mt-3 h-24 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
