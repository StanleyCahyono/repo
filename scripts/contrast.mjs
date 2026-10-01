// WCAG 2.x contrast check for Piste colour tokens (light + dark). Run: node scripts/contrast.mjs [--all]
// Reads the token blocks from src/app/globals.css so the check follows the real values.
//
// Glass HUD: translucent tokens (rgb(r g b / a)) are composited over the page sky before measuring, so "text on
// glass" is checked against what is actually behind the text — the tint over the darkest light-theme sky (sky-1) and
// over the lightest dark-theme sky (sky-3). The blur never helps contrast, so this holds with or without
// backdrop-filter (and the opaque fallback is the plain surface, checked above it).
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
function block(selector) {
  const i = css.indexOf(selector)
  const start = css.indexOf('{', i)
  let depth = 0
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++
    if (css[j] === '}' && --depth === 0) return css.slice(start + 1, j)
  }
  return ''
}
/** Token → [r, g, b, a] (0–255, alpha 0–1). Hex and `rgb(r g b / a)` values only. */
function tokens(text) {
  const out = {}
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*#([0-9a-f]{6})\b/gi)) {
    const h = m[2]
    out[m[1]] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1)
  }
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/gi)) {
    out[m[1]] = [+m[2], +m[3], +m[4], +m[5]]
  }
  return out
}
const light = tokens(block(':root {'))
const dark = { ...light, ...tokens(block(":root[data-theme='dark']")) }

const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1)
function lum(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Resolve "name" or "name@base@base2…": a translucent token composited over its base (default: the sky). */
function resolve(t, spec) {
  const [name, ...rest] = spec.split('@')
  const v = t[name]
  if (!v) return null
  if (v[3] === 1) return v
  const b = resolve(t, rest.length ? rest.join('@') : 'sky')
  return b ? over(v, b) : null
}

const glassBgs = ['glass@sky', 'glass-soft@sky', 'glass-strong@sky']
const onGlass = ['ink', 'ink-2', 'ink-3', 'teal', 'copper', 'eyebrow', 'positive', 'caution', 'critical', 'info', 'demo']

// [foreground, background, minimum]
const pairs = [
  ['ink', 'canvas', 4.5], ['ink', 'surface', 4.5], ['ink-2', 'canvas', 4.5], ['ink-2', 'surface', 4.5], ['ink-3', 'surface', 4.5], ['ink-3', 'canvas', 4.5],
  ['ink-2', 'surface-3', 4.5], ['ink-3', 'surface-2', 4.5],
  ['teal', 'surface', 4.5], ['teal', 'canvas', 4.5], ['teal', 'glacier', 4.5], ['on-teal', 'teal', 4.5], ['copper', 'surface', 4.5],
  ['positive', 'positive-bg', 4.5], ['caution', 'caution-bg', 4.5], ['critical', 'critical-bg', 4.5], ['info', 'info-bg', 4.5], ['demo', 'demo-bg', 4.5],
  ['positive', 'surface', 4.5], ['caution', 'surface', 4.5], ['critical', 'surface', 4.5],
  ['ink', 'positive-bg', 4.5], ['ink', 'caution-bg', 4.5], ['ink', 'critical-bg', 4.5], ['ink', 'info-bg', 4.5], ['ink-2', 'caution-bg', 4.5], ['ink-2', 'critical-bg', 4.5], ['ink-2', 'info-bg', 4.5], ['ink-2', 'positive-bg', 4.5], ['ink-2', 'demo-bg', 4.5],
  ['ikon-ink', 'ikon-bg', 4.5], ['epic-ink', 'epic-bg', 4.5], ['indy-ink', 'indy-bg', 4.5], ['mc-ink', 'mc-bg', 4.5], ['regional-ink', 'regional-bg', 4.5],
  ['ikon-edge', 'ikon-bg', 3], ['epic', 'epic-bg', 3], ['indy', 'indy-bg', 3], ['mc', 'mc-bg', 3], ['regional', 'regional-bg', 3],
  ['divider-strong', 'surface', 1.5], ['teal', 'surface-2', 3],
  // Glass HUD: text on each glass material over the sky, and straight on the sky (page headers).
  ...glassBgs.flatMap((bg) => onGlass.map((fg) => [fg, bg, 4.5])),
  ['ink', 'sky', 4.5], ['ink-2', 'sky', 4.5], ['eyebrow', 'sky', 4.5], ['teal', 'sky', 4.5],
  // Text on chip tracks (segmented track, ghost hover) over glass.
  ['ink', 'chip-track@glass@sky', 4.5], ['ink-2', 'chip-hover@glass@sky', 4.5],
  // Dark HUD chip (primary buttons, selected segments, toasts).
  ['on-ink-chip', 'ink-chip', 4.5], ['on-ink-chip-2', 'ink-chip', 4.5], ['on-ink-chip-accent', 'ink-chip', 4.5],
  // Form fields: text, placeholder, and the field boundary (WCAG 1.4.11: 3:1 against the field).
  ['ink', 'field', 4.5], ['ink-3', 'field', 4.5], ['field-edge@field', 'field', 3],
  // Focus ring against the sky and glass.
  ['focus', 'sky', 3], ['focus', 'glass@sky', 3],
]

let failures = 0
for (const [name, t, sky] of [['light', light, 'sky-1'], ['dark', dark, 'sky-3']]) {
  const tt = { ...t, sky: t[sky] }
  for (const [fg, bg, min] of pairs) {
    const f = resolve(tt, fg)
    const b = resolve(tt, bg)
    if (!f || !b) {
      console.log(`MISSING ${name} ${fg} on ${bg}`)
      failures++
      continue
    }
    const r = ratio(f, b)
    const ok = r >= min
    if (!ok) failures++
    if (!ok || process.argv.includes('--all')) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`)
  }
}
console.log(failures ? `${failures} contrast failures` : 'All token pairs meet their minimum contrast.')
process.exit(failures ? 1 : 0)
