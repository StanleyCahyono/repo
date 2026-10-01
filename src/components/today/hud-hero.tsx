/**
 * Today hero (Glass HUD): the answer in one line over the home mountain, with the skier avatar beside it.
 * The home-mountain photo is cut out of its sky and laid into the page gradient, with a dashed ridge trace and
 * beacons on the home label and the summit. Other home mountains get the plain gradient (no invented art).
 */
import Link from 'next/link'
import { ArrowRight, CircleCheck, Clock3, RefreshCw, TriangleAlert } from 'lucide-react'
import { RefreshButton } from '@/components/sources/refresh-button'
import { SkierAvatar } from '@/components/avatar/skier-avatar'
import { FRESHNESS_JOBS, type FreshnessView } from '@/lib/data/freshness'
import type { HomeMountain, TodayHud } from '@/lib/data/today-hud'
import { assetUrl } from '@/lib/ui/assets'
import { cn } from '@/lib/ui/cn'

/** Greek Peak's ridge in the hero art's 1280×380 space (traced from the cut-out photo). */
const GREEK_PEAK_RIDGE =
  '0,54 24,54 48,55 72,58 96,60 120,63 144,64 168,66 192,67 216,68 240,68 264,68 288,68 312,69 336,72 360,74 384,76 408,81 432,87 456,90 480,94 504,98 528,101 552,102 576,102 600,100 624,96 648,90 672,88 696,86 720,81 744,79 768,76 792,74 816,71 840,67 864,63 888,58 912,56 936,55 960,53 984,49 1008,41 1032,41 1056,38 1080,30 1104,28 1128,26 1152,24 1176,22 1200,21 1224,21 1248,20 1280,21'

function Beacon({ delay = 0 }: { delay?: number }) {
  return (
    <span aria-hidden className="relative block size-3.5">
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${delay}s infinite` }} />
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${delay + 1.1}s infinite` }} />
      <span
        className="piste-beacon-dot absolute inset-[3px] rounded-full bg-teal shadow-[0_0_0_2px_var(--surface),0_0_12px_var(--teal)]"
        style={{ animation: `piste-blink 2.2s linear ${delay}s infinite` }}
      />
    </span>
  )
}

function HeroArt({ home }: { home: HomeMountain }) {
  if (home.id !== 'greek-peak') return <div className="aspect-[1280/380] max-md:aspect-[1280/520]" aria-hidden />
  return (
    <div className="relative aspect-[1280/380] max-md:aspect-[1280/520]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a bundled local asset (also inlined in the single-file build) */}
      <img
        src={assetUrl('greek-peak-hero.webp')}
        alt={`${home.name} seen from the valley, trails cut through the forest`}
        className="absolute inset-0 h-full w-full object-cover object-bottom"
        decoding="async"
      />
      <svg viewBox="0 0 1280 380" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full -translate-y-[7px] overflow-visible max-md:hidden">
        <polyline points={GREEK_PEAK_RIDGE} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-[24.7%] left-[40%] -translate-x-1/2 -translate-y-1/2 max-md:hidden">
        <Beacon />
      </div>
      <Link
        href={home.href}
        className="glass-strong hud absolute top-[24.7%] left-[40%] flex -translate-x-1/2 translate-y-4 flex-col gap-0.5 rounded-[14px] px-3.5 py-2.5 whitespace-nowrap text-ink max-md:top-[10%] max-md:left-4 max-md:translate-x-0"
      >
        <span>{home.name} · home mountain →</span>
        {home.facts ? <span className="text-ink-2">{home.facts}</span> : null}
      </Link>
      <div className="absolute top-[6.8%] left-[88.1%] -translate-x-1/2 -translate-y-1/2 max-md:hidden">
        <Beacon delay={0.7} />
      </div>
    </div>
  )
}

const CHIP_DOT: Record<HomeMountain['chipTone'], string> = { estimate: 'bg-copper', announced: 'bg-teal', open: 'bg-positive', unknown: 'bg-ink-3' }
const FRESHNESS_ICON = { current: CircleCheck, failed: TriangleAlert, running: RefreshCw, stale: Clock3, never: Clock3 } as const
const FRESHNESS_TONE = { current: 'text-positive', failed: 'text-critical', running: 'text-info', stale: 'text-caution', never: 'text-caution' } as const

/** "Weather updated today 07:02 · Alerts … · Exchange rates …" with Update now (shown in the 7-day snow card). */
export function Freshness({ f }: { f: FreshnessView }) {
  const Icon = FRESHNESS_ICON[f.state]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-divider pt-3">
      <p role="status" className="flex min-w-0 flex-1 basis-[220px] items-start gap-2 text-[13px] leading-snug text-ink-2">
        <Icon aria-hidden className={cn('mt-px size-4 shrink-0', FRESHNESS_TONE[f.state])} />
        <span className="min-w-0">
          <span className="text-ink">{f.text}.</span> {f.detail}.
        </span>
      </p>
      <RefreshButton jobs={FRESHNESS_JOBS} label="Update the weather, alerts and exchange rates now" idleText="Update now" busyText="Updating…" size="sm" />
    </div>
  )
}

export function TodayHero({ hud }: { hud: TodayHud }) {
  const home = hud.home
  const caption = `You · ${hud.ability} · ${hud.daysLogged} ${hud.daysLogged === 1 ? 'day' : 'days'}`
  return (
    <section aria-labelledby="today-title" className="relative -mx-4 -mt-6 flex flex-col-reverse md:-mx-8 md:-mt-8 lg:-mx-12">
      {home ? (
        <div className="relative z-[1] -mt-6 md:-mt-[120px]">
          <HeroArt home={home} />
        </div>
      ) : null}
      <div className="relative z-[2] grid grid-cols-1 gap-6 px-4 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,400px)] md:px-8 md:pt-10 lg:pr-10 lg:pl-12">
        <div className="flex max-w-[640px] flex-col gap-4 md:pt-4">
          <p className="hud tracking-[0.16em] text-teal">{hud.dateLine}</p>
          <h1 id="today-title" className="m-0 text-[clamp(40px,5.8vw,84px)] leading-[0.98] font-light tracking-[-0.04em] text-ink">
            {hud.headline}
          </h1>
          {hud.lead ? <p className="m-0 max-w-[560px] text-[17px] leading-[1.5] text-ink-2 md:text-[19px]">{hud.lead}</p> : null}
          <div className="mt-1 flex flex-wrap gap-2.5">
            {home ? (
              <Link href={home.href} className="glass-strong flex min-h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium text-ink">
                <i aria-hidden className={cn('size-2 rounded-full', CHIP_DOT[home.chipTone])} />
                {home.chip}
              </Link>
            ) : null}
            {home ? (
              <Link href={`${home.href}#getting-there`} className="flex min-h-9 items-center gap-1.5 rounded-full bg-ink-chip px-4 text-[13px] font-medium text-on-ink-chip">
                Ride there <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
        <div className="relative h-[360px] md:h-[470px]">
          <SkierAvatar label={`Your skier avatar (${hud.ability}), idle. Hover to see it carve.`} distance={6.2} />
          <div className="glass-strong hud absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[14px] px-3 py-2 whitespace-nowrap text-ink-2">
            <span>{caption}</span>
            <Link href="/season" className="text-teal">
              Gear locker →
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
