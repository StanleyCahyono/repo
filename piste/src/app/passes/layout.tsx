import { Suspense, type ReactNode } from 'react'
import { FlaskConical } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PassesTabs } from '@/components/passes/tabs'
import { dayLabel, seasonText } from '@/components/passes/format'
import { getCtx } from '@/lib/context'

export default async function PassesLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx()
  return (
    <div>
      <PageHeader
        className="md:mb-6"
        eyebrow={
          <>
            <span>Season {seasonText(ctx.prefs.activeSeasonId)}</span>
            <span aria-hidden>·</span>
            <span>{dayLabel(ctx.today, true)}</span>
            {ctx.mode === 'demo' ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-demo-bg px-1.5 py-0.5 text-demo normal-case tracking-normal">
                <FlaskConical aria-hidden className="size-3.5" /> Demo data
              </span>
            ) : null}
          </>
        }
        title="Passes & Costs"
        lead="Exact access for your pass on your dates, the days you have left, and what a ski day really costs. Unknown stays unknown — never permission, never $0."
      />
      <Suspense fallback={<div aria-hidden className="h-11 border-b border-divider" />}>
        <PassesTabs />
      </Suspense>
      <div className="mt-6 md:mt-8">{children}</div>
    </div>
  )
}
