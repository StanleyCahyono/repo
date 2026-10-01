import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { ForecastNav } from '@/components/forecast/nav'
import { ForecastView } from '@/components/forecast/forecast-view'
import { parseForecastParams } from '@/components/forecast/params'
import { RefreshWeatherButton } from '@/components/forecast/refresh-button'
import { getCtx } from '@/lib/context'
import { getForecastScreen } from '@/lib/data/forecast-screen'

export const metadata: Metadata = { title: 'Forecast' }

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseForecastParams(await searchParams)
  const ctx = await getCtx()
  const screen = await getForecastScreen(ctx, {
    resorts: params.resorts,
    focus: params.focus,
    point: params.point,
    date: params.date,
    month: params.month,
    mode: params.mode,
  })
  const live = ctx.mode === 'live'
  const targets = screen.selected.map((id) => ({ id, name: screen.resorts[id]?.name ?? id }))
  const anyForecast = screen.forecast.resorts.some((f) => f.run)

  return (
    <ForecastNav>
      <ForecastView
        screen={screen}
        actions={
          <>
            {live && targets.length && anyForecast ? <RefreshWeatherButton targets={targets} /> : null}
            <ButtonLink href="/sources" variant="ghost" className="max-md:hidden">
              Sources &amp; Sync <ArrowRight aria-hidden className="size-4" />
            </ButtonLink>
          </>
        }
      />
    </ForecastNav>
  )
}
