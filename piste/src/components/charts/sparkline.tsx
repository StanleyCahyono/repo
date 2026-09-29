/**
 * Word-sized trend line / area / bars for rows and tiles. Pure SVG with a stretched viewBox and non-scaling strokes,
 * so it fills any width without measuring and renders on the server. Decorative data ink only: pass an accessible
 * `label` that states what matters (range, total) — the numbers must also be printed nearby or in a table.
 * Unknown values (null) leave gaps; they are never drawn as zero.
 */
import { area as d3Area, line as d3Line, curveMonotoneX } from 'd3-shape'
import { cn } from '@/lib/ui/cn'
import { TONES, type Tone } from './tones'

export interface SparklineProps {
  /** Evenly spaced values in display units; null = unknown. */
  values: readonly (number | null)[]
  variant?: 'line' | 'area' | 'bars'
  tone?: Tone
  /** Rendered height in px (width follows the container). */
  height?: number
  /** Shared scale bounds (display units). */
  min?: number
  max?: number
  /** A hairline at this value (e.g. freezing). */
  baseline?: number | null
  /** Accessible summary, e.g. "Snowfall next 48 h: 0 to 1.2 in per hour, 9.8 in total". */
  label: string
  className?: string
}

const W = 100
const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function Sparkline({ values, variant = 'line', tone = 'teal', height = 28, min, max, baseline = null, label, className }: SparklineProps) {
  const vs = values.filter(known)
  const lo = min ?? Math.min(variant === 'line' ? Infinity : 0, ...vs, ...(known(baseline) ? [baseline] : []))
  const hiRaw = max ?? Math.max(...vs, ...(known(baseline) ? [baseline] : []))
  const hi = hiRaw === lo ? lo + 1 : hiRaw
  const H = height
  const pad = 2
  const x = (i: number) => (values.length <= 1 ? W / 2 : (i / (values.length - 1)) * W)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2)
  const pts = values.map((v, i) => ({ i, v }))
  const c = TONES[tone]
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('block w-full overflow-visible', className)}
      style={{ height }}
    >
      {vs.length === 0 ? (
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} className="stroke-divider-strong" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ) : variant === 'bars' ? (
        values.map((v, i) => {
          if (!known(v) || v <= lo) return null
          const bw = W / values.length
          const yy = y(v)
          return <rect key={i} x={i * bw + bw * 0.15} y={yy} width={bw * 0.7} height={Math.max(0.5, H - pad - yy)} className={c.fill} />
        })
      ) : (
        <>
          {variant === 'area' ? (
            <path
              d={
                d3Area<{ i: number; v: number | null }>()
                  .defined((p) => known(p.v))
                  .x((p) => x(p.i))
                  .y0(H - pad)
                  .y1((p) => y(p.v as number))
                  .curve(curveMonotoneX)(pts) ?? ''
              }
              className={c.wash}
            />
          ) : null}
          <path
            d={
              d3Line<{ i: number; v: number | null }>()
                .defined((p) => known(p.v))
                .x((p) => x(p.i))
                .y((p) => y(p.v as number))
                .curve(curveMonotoneX)(pts) ?? ''
            }
            fill="none"
            className={c.stroke}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {known(baseline) && baseline >= lo && baseline <= hi ? (
        <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} className="stroke-divider-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  )
}
