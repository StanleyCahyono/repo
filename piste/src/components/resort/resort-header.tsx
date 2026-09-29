/**
 * Compact resort header: licensed photo (with credit) or the contour placeholder, name, locality, region,
 * timezone, operating status, opening label, and the Save / Compare / Add to trip actions.
 */
import { Globe2 } from 'lucide-react'
import { DemoBadge } from '@/components/ui/badge'
import { OpeningTag, StatusPill } from '@/components/ui/status'
import type { ResortSummary } from '@/lib/data/resorts'
import { HeaderArt } from './header-art'
import { BackLink } from './back-link'
import { ResortActions, type ResortActionsProps } from './resort-actions'
import { dayLabel, dotJoin, units, type Units } from './format'
import type { UnitPrefs } from '@/lib/domain/types'
import { Reveal } from './reveal'

function openingLine(r: ResortSummary): string {
  const o = r.opening
  switch (o.label) {
    case 'opened':
      return o.date ? `Opened ${dayLabel(o.date)}` : 'Opened'
    case 'announced':
      return o.date ? `Target ${dayLabel(o.date)}${o.daysAway !== null && o.daysAway > 0 ? ` · in ${o.daysAway} d` : ''}` : 'Opening announced'
    case 'estimated':
      return o.date ? `About ${dayLabel(o.date)}${o.to && o.to !== o.date ? `–${dayLabel(o.to)}` : ''}` : 'Opening estimated'
    default:
      return `${o.seasonId.replace('-', '–')} opening not announced`
  }
}

function elevationLine(r: ResortSummary, u: Units): string | null {
  const base = u.elev(r.baseElevationM)
  const top = u.elev(r.summitElevationM)
  if (base && top) return `${base} → ${top}`
  return base ?? top ?? null
}

export function ResortHeader({ r, zoneAbbrev, unitPrefs, actions }: { r: ResortSummary; zoneAbbrev: string; unitPrefs: UnitPrefs; actions: ResortActionsProps }) {
  const u = units(unitPrefs)
  const place = dotJoin(r.region, r.stateProvince ?? null, r.country !== 'US' ? r.country : null)
  const elev = elevationLine(r, u)
  return (
    <Reveal as="header" id="resort-header" className="mb-4 grid gap-4 md:mb-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[minmax(220px,264px)_minmax(0,1fr)]">
      <HeaderArt seed={r.id} name={r.name} photo={r.photo} className="h-[160px] lg:h-[200px]" />
      <div className="flex min-w-0 flex-col justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <BackLink />
            <p className="eyebrow">{place}</p>
            {r.demo ? (
              <DemoBadge />
            ) : null}
          </div>
          <h1 className="font-display text-[32px] leading-[1.02] text-ink md:text-[44px]">{r.name}</h1>
          {r.locality ? <p className="mt-1 line-clamp-2 max-w-[70ch] text-[14px] text-ink-2">{r.locality}</p> : null}
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-ink-2">
            <StatusPill status={r.status.status} />
            <span className="inline-flex items-center gap-1.5">
              <OpeningTag label={r.opening.label} />
              <span className="tnum text-ink">{openingLine(r)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 tnum">
              <Globe2 aria-hidden className="size-4 text-ink-3" />
              {r.timezone.replace(/_/g, ' ')} <span className="text-ink-3">({zoneAbbrev})</span>
            </span>
            {elev ? <span className="tnum">{elev}</span> : null}
          </div>
          <div id="resort-header-actions" className="hidden shrink-0 md:block">
            <ResortActions variant="header" {...actions} />
          </div>
        </div>
      </div>
    </Reveal>
  )
}
