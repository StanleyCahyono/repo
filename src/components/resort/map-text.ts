'use client'
/** Text measuring for the map labels (browser only): a shared canvas in the page's fonts, and a re-layout signal once web fonts load. */
import { useEffect, useState } from 'react'

/** Shared measuring canvas for label widths (Geist / Geist Mono as rendered). */
let measureCtx: CanvasRenderingContext2D | null = null
const fontCache: { sans?: string; mono?: string } = {}
export function measureText(text: string, size: number, weight: number, mono: boolean): number {
  if (typeof document === 'undefined') return text.length * size * 0.6
  if (!fontCache.sans) {
    fontCache.sans = getComputedStyle(document.body).fontFamily
    const probe = document.createElement('span')
    probe.className = 'font-mono'
    document.body.appendChild(probe)
    fontCache.mono = getComputedStyle(probe).fontFamily
    probe.remove()
  }
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * size * 0.6
  measureCtx.font = `${weight} ${size}px ${mono ? fontCache.mono : fontCache.sans}`
  // A little slack for sub-pixel rendering and the halo.
  return measureCtx.measureText(text).width * 1.04 + 2
}


/** Bumps once the page's web fonts have loaded, so labels measured with a fallback font are laid out again. */
export function useFontsReady(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => live && setN((v) => v + 1)).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return n
}
