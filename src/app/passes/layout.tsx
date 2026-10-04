import { Suspense, type ReactNode } from 'react'
import { DemoBadge } from '@/components/ui/badge'
import { PassesTabs } from '@/components/passes/tabs'
import { PassesTitle } from '@/components/passes/title'
import { dayLabel, seasonText } from '@/components/passes/format'
import css from '@/components/passes/hud.module.css'
import { getCtx } from '@/lib/context'
import { loadPassData } from '@/lib/data/core'
import { cn } from '@/lib/ui/cn'

export default async function PassesLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx()
  const pass = await loadPassData(ctx.db, ctx.prefs.activeSeasonId)
  const mine = pass.owned.filter((o) => o.ownership.holder === 'me').map((o) => o.product.name)
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3 pb-6 md:pb-7">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="hud m-0 flex flex-wrap items-center gap-x-2 gap-y-1 tracking-[0.16em] text-teal">
            <span className={cn(css.blink, 'inline-block size-1.5 rounded-full bg-teal')} aria-hidden />
            <span>Passes and costs</span>
            <span aria-hidden className="text-ink-3">·</span>
            <span className="text-ink-2">Season {seasonText(ctx.prefs.activeSeasonId)}</span>
            <span aria-hidden className="text-ink-3">·</span>
            <span className="text-ink-2">{dayLabel(ctx.today, true)}</span>
            {ctx.mode === 'demo' ? <DemoBadge /> : null}
          </p>
          <p className="hud m-0 tracking-[0.1em] text-ink-2">
            Your pass · <span className="text-ink">{mine.length ? mine.join(' + ') : 'none recorded'}</span>
          </p>
        </div>
        <PassesTitle />
      </header>
      <Suspense fallback={<div aria-hidden className="h-[62px]" />}>
        <PassesTabs />
      </Suspense>
      <div className="mt-5 md:mt-7">{children}</div>
    </div>
  )
}
