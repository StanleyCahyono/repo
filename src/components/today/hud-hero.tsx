/**
 * Today hero (Glass HUD): the answer in one line over the home mountain, with the skier avatar beside it.
 * The home-mountain photo is cut out of its sky and laid into the page gradient, with a dashed ridge trace and
 * beacons on the home label and the summit. Other home mountains get no art (no invented pictures): their drive facts
 * join the chips instead.
 *
 * Layout guarantees (no text over text at any width): the avatar caption always sits inside the hero grid, and the
 * home-mountain label always starts below the grid's bottom edge — at the bottom-left of the photo on phones and
 * tablets, and pinned under the ridge beacon (with a short leader line) from 1024px. Entrance: the date line, title,
 * lead and chips rise in turn (CSS, so nothing waits for hydration); the photo and the avatar fade in.
 */
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleCheck, Clock3, RefreshCw, TriangleAlert } from 'lucide-react'
import { RefreshButton } from '@/components/sources/refresh-button'
import { SkierAvatar } from '@/components/avatar/skier-avatar'
import type { SkierOptions } from '@/components/avatar/skier-scene'
import { FRESHNESS_JOBS, type FreshnessView } from '@/lib/data/freshness'
import type { HomeMountain, TodayHud } from '@/lib/data/today-hud'
import { assetUrl } from '@/lib/ui/assets'
import { cn } from '@/lib/ui/cn'

/** Greek Peak's ridge in the hero art's 1280×380 space (traced from the cut-out photo). */
const GREEK_PEAK_RIDGE =
  '0,54 24,54 48,55 72,58 96,60 120,63 144,64 168,66 192,67 216,68 240,68 264,68 288,68 312,69 336,72 360,74 384,76 408,81 432,87 456,90 480,94 504,98 528,101 552,102 576,102 600,100 624,96 648,90 672,88 696,86 720,81 744,79 768,76 792,74 816,71 840,67 864,63 888,58 912,56 936,55 960,53 984,49 1008,41 1032,41 1056,38 1080,30 1104,28 1128,26 1152,24 1176,22 1200,21 1224,21 1248,20 1280,21'

const delay = (ms: number) => ({ '--rise-delay': `${ms}ms` }) as CSSProperties

/** Whether the hero lays a photo under the grid (the world-season card tucks into it when it does). */
export const hasHeroArt = (home: HomeMountain | null): boolean => home?.id === 'greek-peak'

function Beacon({ delay: d = 0 }: { delay?: number }) {
  return (
    <span aria-hidden className="relative block size-3.5">
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${d}s infinite` }} />
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${d + 1.1}s infinite` }} />
      <span
        className="piste-beacon-dot absolute inset-[3px] rounded-full bg-teal shadow-[0_0_0_2px_var(--surface),0_0_12px_var(--teal)]"
        style={{ animation: `piste-blink 2.2s linear ${d}s infinite` }}
      />
    </span>
  )
}

/** Label top at ≥1024px: under the beacon, but never above the grid's bottom edge (the art is pulled up 120px). */
const LABEL_TOP_LG = 'max(calc(24.7% + 18px), 132px)'

function HeroArt({ home }: { home: HomeMountain }) {
  return (
    <div className="relative aspect-[1280/720] min-[1441px]:[mask-image:linear-gradient(90deg,transparent,#000_7%,#000_93%,transparent)] sm:aspect-[1280/560] md:aspect-[1280/520] lg:aspect-[1280/380]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a bundled local asset (also inlined in the single-file build) */}
      <img
        src={assetUrl('greek-peak-hero.webp')}
        alt={`${home.name} seen from the valley, trails cut through the forest`}
        className="absolute inset-0 h-full w-full object-cover object-bottom"
        decoding="async"
      />
      <svg viewBox="0 0 1280 380" preserveAspectRatio="none" aria-hidden className="absolute inset-0 hidden h-full w-full -translate-y-[7px] overflow-visible lg:block">
        <polyline points={GREEK_PEAK_RIDGE} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-[24.7%] left-[40%] hidden -translate-x-1/2 -translate-y-1/2 lg:block">
        <Beacon />
      </div>
      {/* Leader line from the beacon down to the label. */}
      <span aria-hidden className="absolute top-[24.7%] left-[40%] hidden w-px -translate-x-1/2 bg-teal/70 lg:block" style={{ height: `calc(${LABEL_TOP_LG} - 24.7%)` }} />
      <Link
        href={home.href}
        className={cn(
          'group glass-strong hud absolute bottom-8 left-4 flex max-w-[min(360px,calc(100%-32px))] flex-col gap-0.5 rounded-[14px] px-3.5 py-2.5 text-ink md:bottom-[72px] md:left-8',
          'lg:top-[var(--label-top)] lg:bottom-auto lg:left-[40%] lg:-translate-x-1/2',
        )}
        style={{ '--label-top': LABEL_TOP_LG } as CSSProperties}
      >
        <span className="flex items-center gap-1.5">
          <span className="decoration-teal underline-offset-[3px] group-hover:underline">{home.name} · home mountain</span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
        {home.facts ? <span className="text-ink-2">{home.facts}</span> : null}
      </Link>
      <div className="absolute top-[6.8%] left-[88.1%] hidden -translate-x-1/2 -translate-y-1/2 lg:block">
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

export function TodayHero({ hud, look }: { hud: TodayHud; look?: Partial<SkierOptions> }) {
  const home = hud.home
  const art = hasHeroArt(home)
  const caption = `You · ${hud.ability} · ${hud.daysLogged} ${hud.daysLogged === 1 ? 'day' : 'days'}`
  return (
    <section aria-labelledby="today-title" className="relative -mx-4 -mt-6 flex flex-col-reverse md:-mx-8 md:-mt-8 lg:-mx-12">
      {home && art ? (
        <div className="piste-fade relative z-[1] -mt-6 md:-mt-14 lg:-mt-[120px]" style={delay(60)}>
          <HeroArt home={home} />
        </div>
      ) : null}
      <div className="relative z-[2] grid grid-cols-1 gap-4 px-4 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] md:gap-6 md:px-8 md:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] lg:pr-10 lg:pl-12">
        <div className="flex max-w-[640px] min-w-0 flex-col gap-4 md:pt-4">
          <p className="piste-rise hud m-0 tracking-[0.16em] text-teal" style={delay(0)}>
            {hud.dateLine}
          </p>
          <h1 id="today-title" className="piste-rise m-0 text-[clamp(40px,5.8vw,84px)] leading-[0.98] font-light tracking-[-0.04em] text-balance text-ink" style={delay(50)}>
            {hud.headline}
          </h1>
          {hud.lead ? (
            <p className="piste-rise m-0 max-w-[560px] text-[17px] leading-[1.5] text-pretty text-ink-2 md:text-[19px]" style={delay(110)}>
              {hud.lead}
            </p>
          ) : null}
          {home ? (
            <div className="piste-rise mt-1 flex flex-wrap gap-2.5" style={delay(170)}>
              <Link
                href={home.href}
                className="glass-strong flex min-h-9 items-center gap-2 rounded-[18px] px-3.5 py-1.5 text-[13px] leading-snug font-medium text-ink transition-transform duration-150 hover:-translate-y-px"
              >
                <i aria-hidden className={cn('size-2 shrink-0 rounded-full', CHIP_DOT[home.chipTone])} />
                {home.chip}
              </Link>
              {!art && home.facts ? (
                <span className="hud glass-strong flex min-h-9 items-center rounded-[18px] px-3.5 py-1.5 text-ink-2">
                  <span className="sr-only">{home.name}: </span>
                  {home.facts}
                </span>
              ) : null}
              <Link
                href={`/ride?to=${home.id}&mode=drive`}
                className="group flex min-h-9 items-center gap-1.5 rounded-full bg-ink-chip px-4 text-[13px] font-medium text-on-ink-chip transition-transform duration-150 hover:-translate-y-px"
              >
                Ride there <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </div>
          ) : null}
        </div>
        <div className="piste-fade relative h-[340px] md:h-[400px] lg:h-[470px]" style={delay(140)}>
          <SkierAvatar label={`Your skier avatar (${hud.ability}), idle. Hover to see it carve.`} distance={6.2} {...look} />
          <div className="glass-strong hud absolute bottom-1.5 left-1/2 flex w-max max-w-[calc(100%-8px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-[14px] px-3 py-2 text-center text-ink-2">
            <span className="whitespace-nowrap">{caption}</span>
            <Link href="/season" className="whitespace-nowrap text-teal underline-offset-[3px] hover:underline">
              Gear locker →
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
