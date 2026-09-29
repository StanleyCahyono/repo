/**
 * next/font/local for the single-file build. The build script evaluates src/app/fonts.ts with the same naming rule and
 * writes matching @font-face rules (base64 woff2) and classes into the page's CSS:
 *   `.piste-font-<name>` sets the CSS variable (e.g. --font-plex-sans) to the embedded family plus fallbacks,
 *   `.piste-font-<name>-ff` sets font-family directly.
 */

export interface LocalFontOptions {
  src: string | { path: string; weight?: string; style?: string }[]
  variable?: string
  display?: string
  weight?: string
  style?: string
  fallback?: string[]
  adjustFontFallback?: boolean | string
  preload?: boolean
  declarations?: { prop: string; value: string }[]
}

export function fontNames(options: LocalFontOptions) {
  const base = (options.variable ?? 'font-local').replace(/^--/, '').replace(/^font-/, '')
  const family = `Piste ${base}`
  const fallback = options.fallback ?? []
  return {
    family,
    variableClass: `piste-font-${base}`,
    familyClass: `piste-font-${base}-ff`,
    stack: [`'${family}'`, ...fallback].join(', '),
  }
}

export default function localFont(options: LocalFontOptions) {
  const n = fontNames(options)
  return {
    className: n.familyClass,
    variable: n.variableClass,
    style: { fontFamily: n.stack },
  }
}
