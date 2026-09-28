import localFont from 'next/font/local'

/*
 * Self-hosted OFL fonts (licences in src/fonts/). A plain system sans is only the loading/failure fallback;
 * no metric-matched Arial fallback is generated.
 */
export const barlowCondensed = localFont({
  src: [
    { path: '../fonts/barlow-condensed-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/barlow-condensed-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-barlow-condensed',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['system-ui', 'sans-serif'],
})

export const plexSans = localFont({
  src: [
    { path: '../fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-sans-latin-400-italic.woff2', weight: '400', style: 'italic' },
    { path: '../fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-sans',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['system-ui', 'sans-serif'],
})

export const plexMono = localFont({
  src: [
    { path: '../fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'monospace'],
})
