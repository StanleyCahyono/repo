'use client'
/**
 * Resort header art: the licensed photo with its credit, or the designed contour placeholder. The placeholder's
 * contours drift very slowly — only while the header is on screen and the tab is visible, never under reduced
 * motion (MotionConfig + useReducedMotion). Decorative only: it is not the resort's terrain.
 */
import { useMemo, useRef, useSyncExternalStore } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { topoRings } from '@/components/ui/topo'
import { cn } from '@/lib/ui/cn'

export interface HeaderPhoto {
  src: string
  alt: string
  credit: string
  license: string
  sourceUrl: string
}

export function HeaderArt({ seed, name, photo, className }: { seed: string; name: string; photo: HeaderPhoto | null; className?: string }) {
  if (photo) {
    return (
      <figure className={cn('relative overflow-hidden rounded-[12px] border border-divider bg-surface-3', className)}>
        {/* Licensed photo served from /public with its recorded licence; never hotlinked. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.src} alt={photo.alt} className="absolute inset-0 h-full w-full object-cover" />
        <figcaption className="absolute right-2 bottom-2 max-w-[90%] truncate rounded-sm bg-surface/90 px-1.5 py-0.5 text-[12px] text-ink-2">
          Photo:{' '}
          <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {photo.credit}
          </a>{' '}
          · {photo.license}
        </figcaption>
      </figure>
    )
  }
  return <ContourPlaceholder seed={seed} name={name} className={className} />
}

/** Whether the tab is visible (hidden tabs pause the flourish; the server snapshot is "visible"). */
function useTabVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

function ContourPlaceholder({ seed, name, className }: { seed: string; name: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '0px 0px -10% 0px' })
  const visible = useTabVisible()
  const reduce = useReducedMotion()
  const base = useMemo(() => topoRings(seed, 400, 240, 1), [seed])
  const drift = useMemo(() => topoRings(`${seed}:drift`, 400, 240, 0.55), [seed])
  // Only inside the header, only while on screen and the tab is visible, never under reduced motion.
  const animate = inView && visible && !reduce

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden rounded-[12px] border border-divider bg-[linear-gradient(160deg,var(--glacier),var(--surface-2)_72%)]', className)}
    >
      <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 block h-full w-full" aria-hidden focusable="false">
        {base.map((r, i) => (
          <path
            key={`b${i}`}
            d={r.d}
            fill="none"
            stroke={r.index ? 'var(--topo-line-strong)' : 'var(--topo-line)'}
            strokeWidth={r.index ? 1.1 : 0.8}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <motion.g
          initial={false}
          animate={animate ? { x: [-7, 7], y: [3, -3], opacity: [0.35, 0.7] } : { x: 0, y: 0, opacity: 0.5 }}
          transition={animate ? { duration: 26, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } : { duration: 0 }}
        >
          {drift.map((r, i) => (
            <path key={`d${i}`} d={r.d} fill="none" stroke="var(--topo-line-strong)" strokeWidth={0.7} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
        </motion.g>
      </svg>
      <span className="absolute right-2 bottom-2 rounded-sm bg-surface/85 px-1.5 py-0.5 text-[12px] text-ink-3">No licensed photo · decorative contours</span>
      <span className="sr-only">Decorative contour pattern for {name}; not a map of the resort.</span>
    </div>
  )
}
