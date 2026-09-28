/**
 * Deterministic topographic linework used for headers and as the designed placeholder when no licensed photo
 * exists. Pure SVG, server-rendered, seeded by a string (e.g. resort id) so each resort gets a stable "map".
 * This is decorative — it is NOT the resort's terrain.
 */
import { cn } from '@/lib/ui/cn'

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function closedPath(pts: [number, number][]): string {
  // Catmull–Rom → cubic Bézier, closed.
  const n = pts.length
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d + 'Z'
}

interface Ring {
  d: string
  index: boolean
}

export function topoRings(seed: string, width = 400, height = 240, density = 1): Ring[] {
  const r = rng(hash(seed))
  const peaks = 1 + Math.floor(r() * 2)
  const rings: Ring[] = []
  for (let p = 0; p < peaks; p++) {
    const cx = width * (0.25 + r() * 0.5) + (p === 1 ? width * 0.28 : 0)
    const cy = height * (0.3 + r() * 0.4)
    const rmax = Math.max(width, height) * (0.55 + r() * 0.35) * (p === 1 ? 0.6 : 1)
    const count = Math.round((10 + Math.floor(r() * 5)) * density)
    const harmonics = Array.from({ length: 4 }, (_, j) => ({ amp: (0.1 + r() * 0.14) / (j + 1), phase: r() * Math.PI * 2, k: j + 2 }))
    const stretch = 1.25 + r() * 0.5
    for (let i = count; i >= 1; i--) {
      const rad = (rmax * i) / count
      const wobble = 0.35 + (i / count) * 0.75
      const pts: [number, number][] = []
      const steps = 44
      for (let s = 0; s < steps; s++) {
        const th = (s / steps) * Math.PI * 2
        let m = 1
        for (const h of harmonics) m += h.amp * wobble * Math.sin(h.k * th + h.phase + i * 0.07)
        pts.push([cx + Math.cos(th) * rad * m * stretch, cy + Math.sin(th) * rad * m])
      }
      rings.push({ d: closedPath(pts), index: i % 4 === 0 })
    }
  }
  return rings
}

export function TopoArt({
  seed,
  className,
  density = 1,
  tone = 'default',
  label,
}: {
  seed: string
  className?: string
  density?: number
  tone?: 'default' | 'strong'
  /** When set, the art is exposed to assistive tech with this label; otherwise decorative. */
  label?: string
}) {
  const rings = topoRings(seed, 400, 240, density)
  return (
    <svg
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      className={cn('block h-full w-full', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {rings.map((ring, i) => (
        <path
          key={i}
          d={ring.d}
          fill="none"
          stroke={ring.index || tone === 'strong' ? 'var(--topo-line-strong)' : 'var(--topo-line)'}
          strokeWidth={ring.index ? 1.1 : 0.8}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/** Designed placeholder shown where a licensed photograph is unavailable. */
export function PhotoPlaceholder({ seed, name, className }: { seed: string; name: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-[linear-gradient(160deg,var(--glacier),var(--surface-2)_70%)]', className)}>
      <TopoArt seed={seed} />
      <span className="absolute right-2 bottom-2 rounded-sm bg-surface/80 px-1.5 py-0.5 text-[11px] text-ink-3 backdrop-blur-[2px]">
        No licensed photo · decorative contours
      </span>
      <span className="sr-only">Decorative contour pattern for {name}; not a map of the resort.</span>
    </div>
  )
}
