'use client'
/**
 * The "Ride there" sheet: from/to card with the "Where to?" search, quick picks, count-up chips, the ways to go
 * compared like ride options (time · cost · effort · unknowns), departure airports, modeled weather at the mountain
 * (only when stored), the journey as an ordered list (the map's text alternative) and what is still unknown.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Car as CarIcon, CloudSnow, Flag, Home, Plane as PlaneIcon, PlaneLanding, PlaneTakeoff, RotateCcw, TrainFront } from 'lucide-react'
import type { RideIndex, RidePlan } from '@/lib/data/ride'
import { driveEffort, EFFORT_TEXT } from '@/lib/domain/journey'
import { formatDistance, formatDuration, formatSnow, formatSpeed, formatTemp, distanceValue } from '@/lib/domain/units'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { CountUp } from './count-up'
import { WhereTo } from './where-to'
import type { Journey, RideMode, RideSelection } from './journey-model'

export interface RideSheetProps {
  plan: RidePlan | null
  index: RideIndex | null
  sel: RideSelection | null
  journey: Journey | null
  modes: RideMode[]
  pending: boolean
  replay: number
  listId: string
  onPick: (id: string) => void
  onSelect: (s: Partial<RideSelection>) => void
  onReplay: () => void
  homeName: string
}

const durationFmt = (n: number) => formatDuration(Math.round(n)) ?? ''

export function RideSheet(p: RideSheetProps) {
  const { plan, index, sel } = p
  const runKey = `${plan?.resort.id ?? 'none'}:${sel?.mode}:${sel?.via}:${sel?.from}:${p.replay}`
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3.5 border-b border-divider px-5 pt-5 pb-4 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <h1 id="ride-title" className="eyebrow m-0">
            Ride there
          </h1>
          <span className="hud text-[11px] text-ink-2">From {p.homeName}</span>
        </div>
        <RouteCard plan={plan} index={index} pending={p.pending} onPick={p.onPick} homeName={p.homeName} />
        {index ? <QuickPicks index={index} current={plan?.resort.id ?? null} onPick={p.onPick} pending={p.pending} /> : null}
      </div>

      <div className={cn('flex flex-1 flex-col gap-5 px-5 pt-4 pb-6 transition-opacity duration-200 md:px-6', p.pending && 'opacity-60')}>
        {!plan || !sel ? (
          <IdleNote homeName={p.homeName} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${plan.resort.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={t.pageIn}
              className="flex flex-col gap-5"
            >
              <Chips plan={plan} sel={sel} runKey={runKey} />
              {plan.weather ? <WeatherStrip plan={plan} /> : null}
              <Options plan={plan} sel={sel} modes={p.modes} onSelect={p.onSelect} />
              {sel.mode === 'fly' && plan.origins.length > 1 ? <Origins plan={plan} sel={sel} onSelect={p.onSelect} /> : null}
              <Steps plan={plan} journey={p.journey} listId={p.listId} />
              <Unknowns plan={plan} />
              <Footer plan={plan} sel={sel} onReplay={p.onReplay} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

function RouteCard({ plan, index, pending, onPick, homeName }: { plan: RidePlan | null; index: RideIndex | null; pending: boolean; onPick: (id: string) => void; homeName: string }) {
  return (
    <div className="rounded-[20px] bg-surface shadow-[0_1px_0_rgb(19_32_44/0.06),0_6px_18px_rgb(19_32_44/0.06)]">
      <div className="flex items-center gap-3 border-b border-divider px-4 py-3">
        <i aria-hidden className="block size-2.5 shrink-0 rounded-full border-[2.5px] border-ink" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{homeName}</span>
        <span className="hud text-[10.5px] text-ink-2">Home</span>
      </div>
      <div className="flex items-center gap-3 px-4 py-1.5">
        <i aria-hidden className="block size-2.5 shrink-0 bg-teal" />
        {index ? (
          <WhereTo resorts={index.resorts} picks={index.picks} current={plan ? { id: plan.resort.id, name: plan.resort.short, where: plan.resort.where } : null} pending={pending} onPick={onPick} />
        ) : (
          <span className="flex h-11 min-w-0 flex-1 items-center truncate text-[21px] font-semibold tracking-[-0.02em] text-ink">{plan?.resort.short}</span>
        )}
      </div>
      {plan ? <p className="hud truncate px-4 pb-2.5 pl-[38px] text-[10.5px] text-ink-2">{plan.resort.where}</p> : null}
    </div>
  )
}

function QuickPicks({ index, current, onPick, pending }: { index: RideIndex; current: string | null; onPick: (id: string) => void; pending: boolean }) {
  const picks = index.picks.map((id) => index.resorts.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
  if (!picks.length) return null
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
      {picks.map((r) => {
        const on = r.id === current
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            disabled={pending && !on}
            onClick={() => onPick(r.id)}
            className={cn(
              'h-11 shrink-0 rounded-full border px-4 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150',
              on ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'border-divider-strong bg-glass-strong text-ink hover:border-teal hover:text-teal',
            )}
          >
            {r.short}
          </button>
        )
      })}
    </div>
  )
}

function IdleNote({ homeName }: { homeName: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-dashed border-divider-strong p-5">
      <p className="hud text-[11px] text-teal">Standing by</p>
      <p className="m-0 text-[15px] leading-relaxed text-ink">
        Pick a resort. Piste draws the drive or the flight from {homeName}, compares the ways to go, and says plainly what it doesn’t know.
      </p>
      <p className="m-0 text-[13px] text-ink-2">Drive times are curated estimates. Flights are illustrative arcs, never times or fares.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chips

function Chip({ k, children, note, tone = 'default' }: { k: string; children: ReactNode; note?: ReactNode; tone?: 'default' | 'unknown' }) {
  return (
    <div className="flex min-w-[104px] flex-1 basis-[104px] flex-col gap-0.5 rounded-[16px] bg-ink/[0.045] px-3.5 py-2.5">
      <span className="hud text-[10.5px] text-ink-2">{k}</span>
      <span className={cn('tnum text-[18px] font-semibold tracking-[-0.01em] whitespace-nowrap', tone === 'unknown' ? 'text-ink-3 italic' : 'text-ink')}>{children}</span>
      {note ? <span className="hud text-[10px] leading-snug tracking-[0.08em] text-copper">{note}</span> : null}
    </div>
  )
}

function Chips({ plan, sel, runKey }: { plan: RidePlan; sel: RideSelection; runKey: string }) {
  const u = plan.units
  const unit = u.distance
  if (sel.mode === 'drive') {
    const d = plan.drive
    const km = d?.km ?? null
    const lb = plan.leaveBy
    return (
      <div className="flex flex-wrap gap-2">
        {km != null ? (
          <Chip k="Distance" note="Drive estimate">
            <CountUp value={distanceValue(km, u) ?? 0} format={(n) => `${Math.round(n).toLocaleString('en-US')} ${unit}`} runKey={runKey} />
          </Chip>
        ) : (
          <Chip k="Straight line" note="Not a road distance">
            <CountUp value={distanceValue(plan.straightKm, u) ?? 0} format={(n) => `${Math.round(n).toLocaleString('en-US')} ${unit}`} runKey={runKey} />
          </Chip>
        )}
        {d ? (
          <Chip k="Drive" note={d.winterMinutes != null ? `Est. · ${formatDuration(d.winterMinutes)} in winter` : 'Estimate'}>
            <CountUp value={d.minutes} format={durationFmt} runKey={runKey} delay={120} />
          </Chip>
        ) : (
          <Chip k="Drive" tone="unknown" note="No estimate recorded">
            Unknown
          </Chip>
        )}
        {lb.state === 'known' ? (
          <Chip k="Leave by" note={`Lift ${lb.firstLift} · ${lb.dayLabel}`}>
            {lb.leave}
          </Chip>
        ) : (
          <Chip k="Leave by" tone="unknown" note={lb.short}>
            Unknown
          </Chip>
        )}
      </div>
    )
  }
  const gw = plan.gateways.find((g) => g.iata === sel.via) ?? plan.gateways[0]
  const origin = plan.origins.find((o) => o.iata === sel.from) ?? plan.origins[0]
  return (
    <div className="flex flex-wrap gap-2">
      <Chip k="Fly" note={origin?.minutes != null ? `${formatDuration(origin.minutes)} to ${origin.iata} · est.` : 'Departure airport'}>
        {origin?.iata ?? '—'} → {gw?.iata ?? '—'}
      </Chip>
      {gw?.minutes != null ? (
        <Chip k="Transfer" note="Recorded">
          <CountUp value={gw.minutes} format={durationFmt} runKey={runKey} delay={120} />
        </Chip>
      ) : (
        <Chip k="Transfer" tone="unknown" note="Not recorded">
          Unknown
        </Chip>
      )}
      <Chip k="Flight" tone="unknown" note="No times or fares">
        Not shown
      </Chip>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Weather (modeled, only when stored)

function WeatherStrip({ plan }: { plan: RidePlan }) {
  const w = plan.weather!
  const u = plan.units
  return (
    <section aria-labelledby="ride-wx" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ride-wx" className="eyebrow m-0 flex items-center gap-1.5">
          <CloudSnow aria-hidden className="size-3.5" /> Likely at {w.where}
        </h2>
        <span className={cn('hud text-[10px]', w.demo ? 'text-demo' : 'text-ink-2')}>{w.source}</span>
      </div>
      <ol className="grid grid-cols-6 gap-1 rounded-[16px] bg-ink/[0.045] p-1.5">
        {w.hours.map((h) => (
          <li key={h.label} className="flex flex-col items-center gap-0.5 rounded-[10px] py-1.5 text-center">
            <span className="hud text-[10px] text-ink-2">{h.label}</span>
            <span className="tnum text-[14px] font-semibold text-ink">{formatTemp(h.tempC, u) ?? '—'}</span>
            <span className="tnum text-[11px] text-teal">{h.snowCm != null ? (formatSnow(h.snowCm, u) ?? '—') : '—'}</span>
            <span className="tnum text-[10.5px] text-ink-3">{formatSpeed(h.windKmh, u) ?? ''}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 text-[12px] text-ink-3">Weather-model output at the mountain, not along the road. A dash means the model gave no value.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Ways to go

function OptionRow({
  on,
  code,
  icon,
  title,
  facts,
  time,
  timeNote,
  onClick,
}: {
  on: boolean
  code: string
  icon: ReactNode
  title: string
  facts: { k: string; v: string; unknown?: boolean }[]
  time: string
  timeNote: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-3.5 rounded-[20px] border-[1.5px] p-3 text-left transition-[background-color,border-color] duration-150',
        on ? 'border-ink bg-surface shadow-lift' : 'border-transparent bg-ink/[0.04] hover:bg-ink/[0.07]',
      )}
    >
      <span className="flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] bg-ink-chip text-on-ink-chip">
        {icon}
        <span className="font-mono text-[9.5px] leading-none font-semibold tracking-[0.06em]">{code}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] leading-tight font-semibold text-ink">{title}</span>
        <span className="flex flex-col gap-0.5">
          {facts.map((f) => (
            <span key={f.k} className="text-[12.5px] leading-snug text-ink-2">
              <span className="text-ink-3">{f.k}:</span> <span className={f.unknown ? 'text-ink-3 italic' : ''}>{f.v}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
        <span className="tnum text-[16px] font-semibold whitespace-nowrap text-ink">{time}</span>
        <span className="hud text-[10px] text-ink-2">{timeNote}</span>
      </span>
    </button>
  )
}

function Options({ plan, sel, modes, onSelect }: { plan: RidePlan; sel: RideSelection; modes: RideMode[]; onSelect: (s: Partial<RideSelection>) => void }) {
  const d = plan.drive
  const origin = plan.origins.find((o) => o.iata === sel.from) ?? plan.origins[0]
  const effort = driveEffort(d?.winterMinutes ?? d?.minutes ?? null)
  const driveUnknowns = 2 + (plan.leaveBy.state === 'unknown' ? 1 : 0)
  return (
    <section aria-labelledby="ride-ways" className="flex flex-col gap-2">
      <h2 id="ride-ways" className="eyebrow m-0">
        Ways to go
      </h2>
      <div role="radiogroup" aria-labelledby="ride-ways" className="flex flex-col gap-2">
        {modes.includes('drive') ? (
          <OptionRow
            on={sel.mode === 'drive'}
            code="CAR"
            icon={<CarIcon aria-hidden className="size-4" />}
            title={d ? 'Drive' : 'Drive · no estimate recorded'}
            facts={[
              { k: 'Cost', v: 'Not estimated', unknown: true },
              { k: 'Effort', v: effort ? EFFORT_TEXT[effort] : 'Unknown', unknown: !effort },
              { k: 'Unknowns', v: d ? `${driveUnknowns} (road weather, cost${plan.leaveBy.state === 'unknown' ? ', leave-by' : ''})` : 'Time and distance' },
            ]}
            time={d ? (formatDuration(d.minutes) ?? '') : 'Unknown'}
            timeNote={d ? 'Est. one way' : 'No data'}
            onClick={() => onSelect({ mode: 'drive' })}
          />
        ) : null}
        {modes.includes('fly')
          ? plan.gateways.map((g) => {
              const ground = (origin?.minutes ?? 0) + (g.minutes ?? 0)
              const known = origin?.minutes != null && g.minutes != null
              return (
                <OptionRow
                  key={g.iata}
                  on={sel.mode === 'fly' && sel.via === g.iata}
                  code={g.iata}
                  icon={<PlaneIcon aria-hidden className="size-4" />}
                  title={`Fly to ${g.city ?? g.name ?? g.iata}`}
                  facts={[
                    { k: 'Cost', v: 'Fares not shown', unknown: true },
                    { k: 'Effort', v: `High · drive to ${origin?.iata ?? 'the airport'}, fly, then ${g.minutes != null ? formatDuration(g.minutes) : 'a'} transfer` },
                    { k: 'Unknowns', v: 'Flight times, airlines, fares' },
                  ]}
                  time={known ? (formatDuration(ground) ?? '') : 'Unknown'}
                  timeNote={known ? 'Ground + flight' : 'Not recorded'}
                  onClick={() => onSelect({ mode: 'fly', via: g.iata })}
                />
              )
            })
          : null}
      </div>
      {plan.verdictNote ? <p className="m-0 text-[12.5px] leading-snug text-ink-2">Piste’s read: {plan.verdictNote}.</p> : null}
    </section>
  )
}

function Origins({ plan, sel, onSelect }: { plan: RidePlan; sel: RideSelection; onSelect: (s: Partial<RideSelection>) => void }) {
  return (
    <section aria-labelledby="ride-from" className="flex flex-col gap-2">
      <h2 id="ride-from" className="eyebrow m-0">
        Depart from
      </h2>
      <div role="radiogroup" aria-labelledby="ride-from" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        {plan.origins.map((o) => {
          const on = sel.from === o.iata
          return (
            <button
              key={o.iata}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${o.iata}${o.name ? `, ${o.name}` : ''}${o.minutes != null ? `, ${formatDuration(o.minutes)} drive from home (estimate)` : ''}`}
              onClick={() => onSelect({ from: o.iata })}
              className={cn(
                'flex h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 transition-colors duration-150',
                on ? 'border-ink-chip bg-ink-chip text-on-ink-chip' : 'border-divider-strong bg-glass-strong text-ink hover:border-teal',
              )}
            >
              <span className="font-mono text-[12.5px] font-semibold tracking-[0.06em]">{o.iata}</span>
              <span className={cn('tnum text-[12px]', on ? 'text-on-ink-chip-2' : 'text-ink-2')}>{o.minutes != null ? formatDuration(o.minutes) : '?'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The journey as a list (text alternative for the map)

function Steps({ plan, journey, listId }: { plan: RidePlan; journey: Journey | null; listId: string }) {
  if (!journey) return null
  const u = plan.units
  const items: { icon: ReactNode; title: string; detail: string }[] = []
  if (journey.mode === 'drive') {
    const d = plan.drive
    const lb = plan.leaveBy
    items.push({
      icon: <Home aria-hidden className="size-4" />,
      title: `Leave ${plan.home.name}`,
      detail: lb.state === 'known' ? `By ${lb.leave} on ${lb.leaveDay} for the ${lb.firstLift} first lift (${lb.dayLabel})` : 'Leave-by time unknown',
    })
    items.push({
      icon: <CarIcon aria-hidden className="size-4" />,
      title: d ? `Drive ${formatDuration(d.minutes)} (estimate)` : 'Drive (no estimate recorded)',
      detail: [d?.km != null ? formatDistance(d.km, u) : `${formatDistance(plan.straightKm, u)} in a straight line`, d?.winterMinutes != null ? `${formatDuration(d.winterMinutes)} with your ${d.bufferPct}% winter buffer` : null]
        .filter(Boolean)
        .join(' · '),
    })
  } else {
    for (const leg of journey.legs) {
      if (leg.kind === 'ground')
        items.push({ icon: <PlaneTakeoff aria-hidden className="size-4" />, title: `Drive to ${leg.toLabel}`, detail: leg.minutes != null ? `${formatDuration(leg.minutes)} from ${plan.home.name} (estimate)` : 'Drive time not recorded' })
      if (leg.kind === 'air')
        items.push({ icon: <PlaneIcon aria-hidden className="size-4" />, title: `Fly ${leg.fromLabel} → ${leg.toLabel}`, detail: `Illustrative arc, ${formatDistance(leg.km, u)} as the crow flies. No flight times, airlines or fares shown` })
      if (leg.kind === 'transfer') {
        const tr = plan.transfers[0]
        items.push({
          icon: tr?.type === 'train' ? <TrainFront aria-hidden className="size-4" /> : <PlaneLanding aria-hidden className="size-4" />,
          title: `Transfer ${leg.fromLabel} → ${plan.resort.short}`,
          detail: [leg.minutes != null ? formatDuration(leg.minutes) : 'Time not recorded', tr ? tr.name : null].filter(Boolean).join(' · '),
        })
      }
    }
  }
  items.push({ icon: <Flag aria-hidden className="size-4" />, title: `Arrive at ${plan.resort.name}`, detail: plan.resort.where })
  return (
    <section aria-labelledby="ride-steps" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ride-steps" className="eyebrow m-0">
          The journey
        </h2>
        <span className="hud text-[10px] text-ink-3">Text version of the map</span>
      </div>
      <ol id={listId} className="relative flex flex-col">
        {items.map((it, i) => (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {i < items.length - 1 ? <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px border-l border-dashed border-teal/50" /> : null}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-glacier text-teal">{it.icon}</span>
            <span className="flex min-w-0 flex-col pt-1">
              <span className="text-[14px] font-medium text-ink">{it.title}</span>
              {it.detail ? <span className="text-[12.5px] leading-snug text-ink-2">{it.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Unknowns({ plan }: { plan: RidePlan }) {
  const lb = plan.leaveBy
  const extra = lb.state === 'unknown' && lb.lastSeason ? [`For reference only, last season’s published first lift was ${lb.lastSeason}.`] : []
  const list = [...plan.unknowns, ...extra]
  if (!list.length) return null
  return (
    <section aria-labelledby="ride-unknown" className="flex flex-col gap-2 rounded-[18px] border border-dashed border-divider-strong px-4 py-3.5">
      <h2 id="ride-unknown" className="eyebrow m-0">
        Still unknown
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {list.map((u) => (
          <li key={u} className="flex gap-2 text-[13px] leading-snug text-ink-2">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{u}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Footer({ plan, sel, onReplay }: { plan: RidePlan; sel: RideSelection; onReplay: () => void }) {
  const search = sel.mode === 'fly' && sel.from && sel.via ? plan.flightSearch[`${sel.from}-${sel.via}`] : null
  const ext = sel.mode === 'drive' && plan.drive?.directionsUrl ? { label: 'Directions in Google Maps', url: plan.drive.directionsUrl } : search
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="hud text-[10.5px] text-ink-2">◇ Recorded travel data</span>
        <button
          type="button"
          onClick={onReplay}
          className="flex h-11 items-center gap-2 rounded-full bg-ink-chip px-5 text-[14px] font-medium text-on-ink-chip transition-colors duration-150 hover:bg-teal hover:text-on-teal"
        >
          <RotateCcw aria-hidden className="size-4" /> Replay route
        </button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Link href={plan.resort.href} className="flex min-h-11 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline">
          {plan.resort.short} resort page <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
        {ext ? (
          <a href={ext.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1 text-[13.5px] font-medium text-teal hover:underline">
            {ext.label} <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      {ext ? <p className="m-0 -mt-1 text-[12px] text-ink-3">{sel.mode === 'drive' ? 'Google’s live time is its own estimate, not Piste data.' : 'Opens a flight search. Piste shows no fares or schedules from it.'}</p> : null}
    </div>
  )
}
