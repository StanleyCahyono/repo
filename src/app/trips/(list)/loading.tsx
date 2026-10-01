import { Skeleton } from '@/components/ui/states'

/** Trips list skeleton: HUD header, stat tiles, the next trip and a couple of cards (glass, like the page). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading trips…</p>
      <Skeleton className="h-3 w-64" />
      <Skeleton className="mt-4 h-14 w-[min(420px,80%)]" />
      <Skeleton className="mt-4 h-4 w-[min(560px,90%)]" />
      <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="glass rounded-[24px] px-5 py-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-8 w-14" />
          </div>
        ))}
      </div>
      <div className="glass mt-8 h-64 rounded-[32px]" />
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1].map((k) => (
          <div key={k} className="glass h-56 rounded-[28px]" />
        ))}
      </div>
    </div>
  )
}
