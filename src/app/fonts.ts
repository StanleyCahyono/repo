import localFont from 'next/font/local'

/*
 * Self-hosted OFL fonts (licences in src/fonts/): Geist for display and text, Geist Mono for HUD labels,
 * measurements and timestamps. A plain system sans is only the loading/failure fallback; no metric-matched Arial
 * fallback is generated.
 */
export const geist = localFont({
  src: [
    { path: '../fonts/geist-latin-300-normal.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/geist-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/geist-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/geist-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-geist',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['system-ui', 'sans-serif'],
})

export const geistMono = localFont({
  src: [
    { path: '../fonts/geist-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/geist-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-geist-mono',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'monospace'],
})
