'use client'
/**
 * Resort hero — the opening scene of the scroll story. A sticky stage holds the resort's name in huge light type
 * over its mountain: the bundled cut-out picture where Piste has one (Matterhorn for Zermatt, the valley view for
 * Greek Peak), otherwise generated ridgeline-and-contour art shaped by the resort's real vertical (labelled as
 * illustrative, never a photo or a map). Scrolling the first part of the page pins the stage while the title lifts
 * away and the mountain grows toward you; then it scrolls on. Reduced motion: no pin, no movement.
 *
 * The glass card carries the real status / opening line, and the HUD line the coordinates and elevations.
 */
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { ArrowDown } from 'lucide-react'
import { DemoBadge } from '@/components/ui/badge'
import { assetUrl } from '@/lib/ui/assets'
import { cn } from '@/lib/ui/cn'
import { BackLink } from './back-link'
import { ResortActions, type ResortActionsProps } from './resort-actions'
import { ART_H, ART_W, terrainArt } from './terrain-art'
import { PhotoCredit } from '@/components/ui/photo-credit'

export type HeroTone = 'positive' | 'teal' | 'copper' | 'neutral' | 'critical'

export type HeroArtSpec =
  | { kind: 'photo'; src: string; alt: string; credit: string; license: string; sourceUrl: string }
  | { kind: 'matterhorn'; peakLabel: string; topLabel: string | null }
  | { kind: 'greek-peak'; topLabel: string | null; sub: string | null }
  | { kind: 'terrain'; seed: string; verticalM: number | null; summitM: number | null; topLabel: string | null; baseLabel: string | null; verticalLabel: string | null }

export interface HeroData {
  name: string
  shortName: string
  /** 'Central New York · NY' */
  place: string
  /** 'CORTLAND COUNTY NY · 42.5015°N 76.1390°W · 1,148–2,100 FT' */
  hud: string
  status: { tone: HeroTone; text: string; sub: string | null; note: string | null }
  art: HeroArtSpec
  /** Number of story chapters (for "01 / 07"). */
  chapters: number
  demo: boolean
}

const DOT: Record<HeroTone, string> = {
  positive: 'bg-positive shadow-[0_0_0_4px_color-mix(in_srgb,var(--positive)_22%,transparent)]',
  teal: 'bg-teal shadow-[0_0_0_4px_color-mix(in_srgb,var(--teal)_22%,transparent)]',
  copper: 'bg-copper shadow-[0_0_0_4px_color-mix(in_srgb,var(--copper)_22%,transparent)]',
  neutral: 'bg-ink-3 shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink-3)_18%,transparent)]',
  critical: 'bg-critical shadow-[0_0_0_4px_color-mix(in_srgb,var(--critical)_22%,transparent)]',
}

/** The Matterhorn's ridge in the cut-out's 1280×690 space (traced from the picture). */
const MATTERHORN_RIDGE =
  '420,325 440,266 460,227 480,200 500,185 520,156 540,131 560,111 580,94 600,28 610,17 620,20 640,39 660,64 680,88 700,115 720,145 740,181 760,244 780,250 800,261 820,284 840,297 860,312 880,325 900,340 920,354 940,372 960,391 980,410 1000,428'
/** Greek Peak's ridge in the valley picture's 1280×380 space. */
const GREEK_PEAK_RIDGE =
  '0,54 24,54 48,55 72,58 96,60 120,63 144,64 168,66 192,67 216,68 240,68 264,68 288,68 312,69 336,72 360,74 384,76 408,81 432,87 456,90 480,94 504,98 528,101 552,102 576,102 600,100 624,96 648,90 672,88 696,86 720,81 744,79 768,76 792,74 816,71 840,67 864,63 888,58 912,56 936,55 960,53 984,49 1008,41 1032,41 1056,38 1080,30 1104,28 1128,26 1152,24 1176,22 1200,21 1224,21 1248,20 1280,21'

export function Beacon({ delay = 0, className }: { delay?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('relative block size-3.5', className)}>
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${delay}s infinite` }} />
      <span className="piste-beacon-ring absolute inset-0 rounded-full border-[1.5px] border-teal" style={{ animation: `piste-beacon 2.2s ease-out ${delay + 1.1}s infinite` }} />
      <span className="piste-beacon-dot absolute inset-[3px] rounded-full bg-teal shadow-[0_0_0_2px_var(--surface),0_0_12px_var(--teal)]" />
    </span>
  )
}

function ArtChip({ lines, className, style }: { lines: (string | null)[]; className?: string; style?: React.CSSProperties }) {
  const shown = lines.filter(Boolean)
  if (!shown.length) return null
  return (
    <div className={cn('glass-strong hud absolute flex flex-col gap-0.5 rounded-[14px] px-3 py-2 whitespace-nowrap text-ink max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[10.5px] max-sm:tracking-[0.08em]', className)} style={style}>
      {shown.map((l, i) => (
        <span key={i} className={i ? 'text-ink-2 max-sm:hidden' : undefined}>
          {l}
        </span>
      ))}
    </div>
  )
}

/** Width of an art box of `ratio` (w/h) that fits the free height (container query) and, on phones, overhangs. */
const fitWidth = (ratio: number, min = 1100) => `min(max(${min}px, 100%), calc(100cqh * ${ratio}))`

function MatterhornArt({ art }: { art: Extract<HeroArtSpec, { kind: 'matterhorn' }> }) {
  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: fitWidth(1280 / 690, 900), aspectRatio: '1280 / 690' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled local asset (inlined in the single-file build) */}
      <img
        src={assetUrl('matterhorn-cut.webp')}
        alt="The Matterhorn above Zermatt, snow on its north and east faces"
        className="absolute inset-0 h-full w-full [mask-image:linear-gradient(to_right,transparent,#000_14%,#000_86%,transparent)]"
        decoding="async"
      />
      <svg viewBox="0 0 1280 690" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full -translate-y-[6px] overflow-visible">
        <polyline points={MATTERHORN_RIDGE} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-[1.6%] left-[47.6%] -translate-x-1/2 -translate-y-1/2">
        <Beacon />
      </div>
      <ArtChip lines={[art.peakLabel, art.topLabel]} className="top-[1.6%] left-[47.6%] ml-6 -translate-y-1/2 max-sm:hidden" />
    </div>
  )
}

function GreekPeakArt({ art }: { art: Extract<HeroArtSpec, { kind: 'greek-peak' }> }) {
  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 max-md:right-0 max-md:left-auto max-md:translate-x-[8%]" style={{ width: fitWidth(1280 / 380, 1000), aspectRatio: '1280 / 380' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled local asset (inlined in the single-file build) */}
      <img src={assetUrl('greek-peak-hero.webp')} alt="Greek Peak seen from the valley, trails cut through the forest" className="absolute inset-0 h-full w-full" decoding="async" />
      <svg viewBox="0 0 1280 380" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full -translate-y-[7px] overflow-visible">
        <polyline points={GREEK_PEAK_RIDGE} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-[6.8%] left-[88.1%] -translate-x-1/2 -translate-y-1/2">
        <Beacon />
      </div>
      <ArtChip lines={[art.topLabel, art.sub]} className="top-[6.8%] right-[13%] mr-4 -translate-y-[calc(100%+6px)] max-md:right-[16%] max-md:mr-0 max-md:translate-y-5" />
    </div>
  )
}

/** A licensed photo recorded in the catalog (served from /public, never hotlinked), with its credit. */
function PhotoArt({ art }: { art: Extract<HeroArtSpec, { kind: 'photo' }> }) {
  return (
    <figure className="absolute inset-x-4 top-2 bottom-0 m-0 overflow-hidden rounded-t-[32px] md:inset-x-8">
      {/* eslint-disable-next-line @next/next/no-img-element -- licensed local photo */}
      <img src={art.src} alt={art.alt} className="absolute inset-0 h-full w-full object-cover" />
      <figcaption className="absolute top-3 right-3">
        <PhotoCredit credit={art.credit} license={art.license} sourceUrl={art.sourceUrl} />
      </figcaption>
    </figure>
  )
}

function TerrainArtView({ art, p }: { art: Extract<HeroArtSpec, { kind: 'terrain' }>; p: MotionValue<number> }) {
  const spec = terrainArt(art.seed, art.verticalM, art.summitM)
  const farY = useTransform(p, [0, 1], [0, 60])
  const backY = useTransform(p, [0, 1], [0, 40])
  const midY = useTransform(p, [0, 1], [0, 20])
  const id = `terrain-${art.seed}`
  const pct = (x: number, y: number) => ({ left: `${(x / ART_W) * 100}%`, top: `${(y / ART_H) * 100}%` })
  const peakTop = ((spec.peak.y - 7) / ART_H) * 100
  const footTop = ((spec.foot.y - 7) / ART_H) * 100
  return (
    // Stretched to the free space (wider than a phone, centred): generated art, so it has no true aspect to keep.
    <div className="absolute bottom-0 left-1/2 h-[96%] -translate-x-1/2" style={{ width: 'max(100%, 860px)' }}>
      <svg viewBox={`0 0 ${ART_W} ${ART_H}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--surface)' }} />
            <stop offset={0.3 + (1 - spec.relief) * 0.2} style={{ stopColor: 'color-mix(in srgb, var(--glacier) 70%, var(--surface))' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--glacier) 70%, var(--teal) 18%)' }} />
          </linearGradient>
          {/* Light from the upper left: the far side of every slope sits in shade. */}
          <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="0">
            <stop offset={Math.max(0, spec.peak.x / ART_W - 0.12)} style={{ stopColor: 'var(--teal)', stopOpacity: 0 }} />
            <stop offset={Math.min(1, spec.peak.x / ART_W + 0.1)} style={{ stopColor: 'var(--teal)', stopOpacity: 0.13 }} />
            <stop offset="1" style={{ stopColor: 'var(--teal)', stopOpacity: 0.08 }} />
          </linearGradient>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.7" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="-10" y="-10" width={ART_W + 20} height={ART_H + 20}>
            <rect x="-10" y="-10" width={ART_W + 20} height={ART_H + 20} fill={`url(#${id}-fade)`} />
          </mask>
          <clipPath id={`${id}-clip`}>
            <path d={spec.front.fill} />
          </clipPath>
        </defs>
        <g mask={`url(#${id}-mask)`}>
          <motion.g style={{ y: farY }}>
            <path d={spec.far.fill} style={{ fill: 'color-mix(in srgb, var(--teal) 7%, transparent)' }} />
            <polyline points={spec.far.ridge} fill="none" style={{ stroke: 'color-mix(in srgb, var(--teal) 22%, transparent)' }} strokeWidth="1" strokeDasharray="1 4" vectorEffect="non-scaling-stroke" />
          </motion.g>
          <motion.g style={{ y: backY }}>
            <path d={spec.back.fill} style={{ fill: 'color-mix(in srgb, var(--teal) 13%, var(--sky-2))' }} />
            <polyline points={spec.back.ridge} fill="none" style={{ stroke: 'color-mix(in srgb, var(--teal) 32%, transparent)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </motion.g>
          <motion.g style={{ y: midY }}>
            <path d={spec.mid.fill} style={{ fill: 'color-mix(in srgb, var(--teal) 22%, var(--sky-2))' }} />
            <polyline points={spec.mid.ridge} fill="none" style={{ stroke: 'color-mix(in srgb, var(--teal) 45%, transparent)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </motion.g>
          <path d={spec.front.fill} fill={`url(#${id}-front)`} />
          <g clipPath={`url(#${id}-clip)`}>
            <rect width={ART_W} height={ART_H} fill={`url(#${id}-shade)`} />
            {spec.contours.map((c, i) => (
              <polyline key={i} points={c} fill="none" stroke={i % 4 === 3 ? 'var(--topo-line-strong)' : 'var(--topo-line)'} strokeWidth={i % 4 === 3 ? 1.1 : 0.8} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <polyline points={spec.front.ridge} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" transform="translate(0,-7)" />
        </g>
      </svg>
      {/* Elevation ruler: the real base and summit heights against the drawn ridge (the drawing itself is illustrative). */}
      {art.topLabel && art.baseLabel ? (
        <div aria-hidden className="absolute left-[max(16px,calc(50%-50vw+20px))] w-3 border-l border-[color-mix(in_srgb,var(--teal)_45%,transparent)] max-md:hidden" style={{ top: `${peakTop}%`, height: `${Math.max(4, footTop - peakTop)}%` }}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="absolute left-0 h-px bg-[color-mix(in_srgb,var(--teal)_45%,transparent)]" style={{ top: `${(i / 8) * 100}%`, width: i % 4 === 0 ? 12 : 6 }} />
          ))}
          <span className="hud absolute top-0 left-4 -translate-y-1/2 whitespace-nowrap text-ink-2">{art.topLabel.replace('Summit · ', '')}</span>
        </div>
      ) : null}
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={pct(spec.peak.x, spec.peak.y - 7)}>
        <Beacon />
      </div>
      {art.topLabel ? (
        <ArtChip
          lines={[art.topLabel, art.verticalLabel]}
          className={cn('-translate-y-1/2 max-sm:hidden', spec.peak.x > ART_W * 0.55 ? '-translate-x-[calc(100%+22px)]' : 'translate-x-[22px]')}
          style={pct(spec.peak.x, spec.peak.y - 7)}
        />
      ) : null}
    </div>
  )
}

export function ResortHero({ hero, actions }: { hero: HeroData; actions: ResortActionsProps }) {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  // Progress of the pinned scene over the first ~420px of scroll; frozen under reduced motion.
  const p = useTransform(scrollY, (y) => (reduce ? 0 : Math.min(1, Math.max(0, y / 420))))
  const titleOpacity = useTransform(p, [0, 0.8], [1, 0])
  const titleY = useTransform(p, [0, 1], [0, -90])
  const artScale = useTransform(p, [0, 1], [1, 1.14])
  const hintOpacity = useTransform(p, [0, 0.4], [1, 0])
  const sectionRef = useRef<HTMLElement>(null)
  const len = Math.max(4, hero.shortName.length)

  return (
    <section
      ref={sectionRef}
      id="top"
      aria-labelledby="resort-title"
      className={cn(
        'relative -mx-4 mt-2 [overflow-x:clip] md:-mx-8 md:mt-3 lg:-mx-12',
        '[--stage:max(480px,calc(100svh-262px))] md:[--stage:max(560px,calc(100svh-164px))]',
        'h-[var(--stage)] motion-safe:h-[calc(var(--stage)+40svh)]',
      )}
    >
      <div className="sticky top-[108px] flex h-[var(--stage)] flex-col overflow-hidden md:top-[76px]">
        {/* HUD frame: fine corner ticks, like the mission-control screens. */}
        <span aria-hidden className="pointer-events-none absolute top-3 left-3 size-5 border-t border-l border-[color-mix(in_srgb,var(--teal)_45%,transparent)] md:left-6" />
        <span aria-hidden className="pointer-events-none absolute top-3 right-3 size-5 border-t border-r border-[color-mix(in_srgb,var(--teal)_45%,transparent)] md:right-6" />

        <div className="relative z-[3] flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-4 md:px-10 md:pt-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <BackLink />
            <p className="hud m-0 text-ink-2">{hero.place}</p>
            {hero.demo ? <DemoBadge /> : null}
          </div>
        </div>

        <motion.h1
          id="resort-title"
          style={{ opacity: titleOpacity, y: titleY, fontSize: `clamp(48px, min(19vw, ${Math.round(1500 / len) / 10}vw, 21svh), 260px)` }}
          className="relative z-[1] m-0 shrink-0 px-4 pt-1 text-center leading-[0.92] font-extralight tracking-[-0.06em] text-ink md:pt-2"
        >
          {hero.shortName}
          {hero.name !== hero.shortName ? <span className="sr-only"> ({hero.name})</span> : null}
        </motion.h1>

        {/* The free height below the title is a size container: the art fits it (and overhangs on phones). */}
        <div className="piste-hero-in relative z-[2] min-h-0 flex-1 [container-type:size]">
          <motion.div style={{ scale: artScale }} className="absolute inset-0 origin-bottom">
            {hero.art.kind === 'photo' ? (
              <PhotoArt art={hero.art} />
            ) : hero.art.kind === 'matterhorn' ? (
              <MatterhornArt art={hero.art} />
            ) : hero.art.kind === 'greek-peak' ? (
              <GreekPeakArt art={hero.art} />
            ) : (
              <TerrainArtView art={hero.art} p={p} />
            )}
          </motion.div>
          {/* Phones: the peak label sits as a HUD tag at the top of the scene (the picture overhangs the screen). */}
          {hero.art.kind === 'matterhorn' || (hero.art.kind === 'terrain' && hero.art.topLabel) ? (
            <p className="glass-strong hud absolute top-1 left-4 z-[3] m-0 rounded-[12px] px-2.5 py-1.5 text-[12px] text-ink sm:hidden">
              {hero.art.kind === 'matterhorn' ? hero.art.peakLabel : hero.art.topLabel}
            </p>
          ) : null}
          {hero.art.kind === 'terrain' ? (
            <p className="hud pointer-events-none absolute right-3 bottom-2 z-[3] m-0 rounded-full bg-glass-strong px-2.5 py-1 text-[12px] text-ink-2 md:right-8 md:text-[12px] lg:bottom-[104px]">
              Illustrative terrain · not a map
            </p>
          ) : null}
        </div>

        <div className="relative z-[4] mx-4 mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mx-8 md:mb-6 lg:absolute lg:inset-x-8 lg:bottom-7 lg:m-0">
          <div className="piste-rise glass-strong flex max-w-[540px] min-w-0 flex-col gap-2 rounded-[24px] px-5 py-4 [--rise-delay:180ms] md:rounded-[28px] md:px-[22px] md:py-5">
            <p className="m-0 flex items-start gap-2.5 text-[14px] leading-snug font-semibold text-ink">
              <i aria-hidden className={cn('mt-[5px] size-[9px] shrink-0 rounded-full', DOT[hero.status.tone])} />
              <span>{hero.status.text}</span>
            </p>
            {hero.status.sub ? <p className="m-0 line-clamp-2 text-[14px] leading-[1.5] text-ink-2 md:line-clamp-3 md:text-[15px]">{hero.status.sub}</p> : null}
            {hero.status.note ? <p className="m-0 text-[12.5px] leading-snug font-medium text-caution">{hero.status.note}</p> : null}
            <p className="hud m-0 text-ink-2 max-md:text-[12px]">{hero.hud}</p>
          </div>
          <div className="hidden flex-col items-end gap-3 md:flex">
            <ResortActions variant="header" {...actions} />
            <motion.a style={{ opacity: hintOpacity }} href="#overview" className="hud flex items-center gap-2 text-ink-2 hover:text-teal">
              Scroll · 01 / {String(hero.chapters).padStart(2, '0')} <ArrowDown aria-hidden className="size-3.5" />
            </motion.a>
          </div>
        </div>
      </div>
    </section>
  )
}
