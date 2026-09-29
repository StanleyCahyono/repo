import { Skeleton } from '@/components/ui/states'

/** Trip detail skeleton: header, glance, and a few timeline days. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading trip…</p>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-4 h-4 w-64" />
      <Skeleton className="mt-3 h-10 w-[min(520px,90%)]" />
      <Skeleton className="mt-3 h-4 w-[min(420px,80%)]" />
      <div className="mt-8 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
        <div className="xl:col-start-2 xl:row-start-1">
          <Skeleton className="h-56 w-full rounded-[14px]" />
        </div>
        <div className="mt-8 flex flex-col gap-8 xl:col-start-1 xl:row-start-1 xl:mt-0">
          <Skeleton className="h-10 w-full" />
          {[0, 1, 2].map((k) => (
            <div key={k} className="grid grid-cols-[52px_1fr] gap-4 sm:grid-cols-[76px_1fr]">
              <div>
                <Skeleton className="h-3 w-8" />
                <Skeleton className="mt-2 h-8 w-10" />
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-24 w-full rounded-[10px]" />
                <Skeleton className="h-12 w-full rounded-[10px]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
