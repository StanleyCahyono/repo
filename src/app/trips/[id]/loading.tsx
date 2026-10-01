import { Skeleton } from '@/components/ui/states'

/** Trip planner skeleton: HUD header, the route panel and the dates / budget cards, then the section bar. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading trip…</p>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-5 h-3 w-72" />
      <Skeleton className="mt-4 h-14 w-[min(620px,90%)]" />
      <Skeleton className="mt-4 h-10 w-56 rounded-full" />
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="glass h-[440px] rounded-[32px]" />
        <div className="flex flex-col gap-5">
          <div className="glass h-[420px] rounded-[28px] p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-56" />
            <div className="mt-6 grid grid-cols-7 gap-2">
              {Array.from({ length: 35 }, (_, k) => (
                <Skeleton key={k} className="mx-auto size-8 rounded-full" />
              ))}
            </div>
          </div>
          <div className="glass h-48 rounded-[28px]" />
        </div>
      </div>
      <div className="glass mt-10 h-[50px] rounded-full" />
    </div>
  )
}
