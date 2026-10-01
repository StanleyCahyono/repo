// WCAG 2.x contrast check for Piste colour tokens (light + dark). Run: node scripts/contrast.mjs
// Reads the token blocks from src/app/globals.css so the check follows the real values.
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
function tokens(text) {
  const out = {}
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2]
  return out
}
const light = tokens(block(':root {'))
const dark = { ...light, ...tokens(block(":root[data-theme='dark']")) }

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [foreground, background, minimum]
const pairs = [
  ['ink', 'canvas', 4.5], ['ink', 'surface', 4.5], ['ink-2', 'canvas', 4.5], ['ink-2', 'surface', 4.5], ['ink-3', 'surface', 4.5], ['ink-3', 'canvas', 4.5],
  ['ink-2', 'surface-3', 4.5], ['ink-3', 'surface-2', 4.5],
  ['teal', 'surface', 4.5], ['teal', 'canvas', 4.5], ['teal', 'glacier', 4.5], ['on-teal', 'teal', 4.5], ['copper', 'surface', 4.5],
  ['positive', 'positive-bg', 4.5], ['caution', 'caution-bg', 4.5], ['critical', 'critical-bg', 4.5], ['info', 'info-bg', 4.5], ['demo', 'demo-bg', 4.5],
  ['positive', 'surface', 4.5], ['caution', 'surface', 4.5], ['critical', 'surface', 4.5],
  ['ikon-ink', 'ikon-bg', 4.5], ['epic-ink', 'epic-bg', 4.5], ['indy-ink', 'indy-bg', 4.5], ['mc-ink', 'mc-bg', 4.5], ['regional-ink', 'regional-bg', 4.5],
  ['ikon-edge', 'ikon-bg', 3], ['epic', 'epic-bg', 3], ['indy', 'indy-bg', 3], ['mc', 'mc-bg', 3], ['regional', 'regional-bg', 3],
  ['divider-strong', 'surface', 1.5], ['teal', 'surface-2', 3],
]
let failures = 0
for (const [name, t] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min] of pairs) {
    if (!t[fg] || !t[bg]) continue
    const r = ratio(t[fg], t[bg])
    const ok = r >= min
    if (!ok) failures++
    if (!ok || process.argv.includes('--all')) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`)
  }
}
console.log(failures ? `${failures} contrast failures` : 'All token pairs meet their minimum contrast.')
process.exit(failures ? 1 : 0)
