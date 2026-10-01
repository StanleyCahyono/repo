import { Skeleton } from '@/components/ui/states'

/**
 * App-wide loading state (Today and any screen without its own loading.tsx), in the Glass HUD shape of Today: the
 * HUD eyebrow, a two-line display title, the lead and the two hero pills, the hero band, the slim world-season bar
 * and three glass cards. Soft breathing blocks (static under reduced motion), announced once.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading…</p>
      <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 pt-2 md:pt-6">
          <Skeleton className="h-3 w-56 max-w-full" />
          <Skeleton className="mt-5 h-11 w-[min(520px,92%)] rounded-[14px] md:h-16" />
          <Skeleton className="mt-3 h-11 w-[min(420px,70%)] rounded-[14px] md:h-16" />
          <Skeleton className="mt-6 h-4 w-[min(540px,95%)]" />
          <Skeleton className="mt-2.5 h-4 w-[min(420px,80%)]" />
          <div className="mt-6 flex flex-wrap gap-2">
            <Skeleton className="h-10 w-[min(300px,80vw)] rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
        </div>
        <div aria-hidden className="hidden h-[300px] items-end justify-center lg:flex">
          <Skeleton className="h-16 w-[320px] rounded-[50%]" />
        </div>
      </div>
      <div className="glass-soft mt-10 flex h-16 items-center gap-4 rounded-[24px] px-6 md:mt-14">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="hidden h-3 w-56 md:block" />
        <Skeleton className="ml-auto h-7 w-[min(280px,40%)] rounded-full" />
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((k) => (
          <div key={k} className="glass-soft flex flex-col gap-4 rounded-[28px] px-[22px] py-5">
            <Skeleton className="h-3 w-40" />
            <div className="flex justify-between gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="size-12 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-10 w-full rounded-[14px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
