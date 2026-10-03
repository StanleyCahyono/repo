#!/usr/bin/env node
/**
 * Overlap audit: loads each route at several widths/themes (live and demo) and reports text drawn on top of other
 * text, text clipped by its box, and horizontal page overflow. Writes a JSON report plus a cropped PNG per finding.
 *
 *   node scripts/overlap-audit.mjs --base http://localhost:3000 --out audit [--widths 390,768,1440] [--themes light,dark]
 *        [--modes live,demo] [--routes /,/explore,...] [--hover]
 *
 * Text boxes are measured per rendered line (Range.getClientRects), so a wrapped label is checked line by line.
 * Ignored: fixed/sticky chrome (content scrolls under it by design), aria-hidden decorations, screen-reader-only text,
 * invisible text (opacity ≈ 0 / visibility hidden), and overlaps under 6 px² or 2 px deep.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:3000')
const OUT = arg('out', 'audit')
const WIDTHS = arg('widths', '390,768,1440').split(',').map(Number)
const THEMES = arg('themes', 'light').split(',')
const MODES = arg('modes', 'live,demo').split(',')
const DEFAULT_ROUTES = [
  '/', '/explore', '/explore?view=compare', '/explore?view=events', '/forecast', '/ride', '/ride?to=hunter-mountain&mode=drive', '/ride?to=zermatt&mode=fly',
  '/trips', '/passes', '/passes/products', '/passes/compare', '/passes/costs', '/season', '/settings', '/sources',
  '/resorts/zermatt', '/resorts/greek-peak', '/resorts/alta', '/resorts/niseko-united', '/resorts/whistler-blackcomb', '/resorts/ischgl',
]
const ROUTES = arg('routes', null)?.split(',') ?? DEFAULT_ROUTES
fs.mkdirSync(OUT, { recursive: true })

function measure() {
  const vis = (el) => {
    // Closed <details>: its body still reports layout boxes in Chromium but is not painted.
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) {
      const own = d.querySelector(':scope > summary')
      if (!d.open && !(own && own.contains(el))) return false
    }
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      if (e.getAttribute('aria-hidden') === 'true' && e.dataset.auditText !== 'yes') return false
      if (cs.position === 'fixed' || cs.position === 'sticky') return false
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || (cs.clipPath && cs.clipPath.includes('inset(50%'))) return false
    }
    return true
  }
  // Visible box of an element: the intersection of every ancestor box that clips overflow (collapsed disclosures,
  // carousels and masked panels hide their text this way without display:none).
  const clipCache = new Map()
  const clipOf = (el) => {
    if (!el || el === document.body || el.nodeType !== 1) return { l: -1e9, t: -1e9, r: 1e9, b: 1e9 }
    if (clipCache.has(el)) return clipCache.get(el)
    const up = clipOf(el.parentElement)
    const cs = getComputedStyle(el)
    let box = up
    if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) || cs.contain.includes('paint')) {
      const b = el.getBoundingClientRect()
      box = { l: Math.max(up.l, b.left + scrollX), t: Math.max(up.t, b.top + scrollY), r: Math.min(up.r, b.right + scrollX), b: Math.min(up.b, b.bottom + scrollY) }
    }
    clipCache.set(el, box)
    return box
  }
  const items = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Map()
  let id = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const el = n.parentElement
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION'].includes(el.tagName)) continue
    if (!seen.has(el)) {
      if (!vis(el)) {
        seen.set(el, null)
        continue
      }
      seen.set(el, id++)
    }
    const eid = seen.get(el)
    if (eid == null) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const c = clipOf(el)
    for (const b of r.getClientRects()) {
      const l = Math.max(b.left + scrollX, c.l), t = Math.max(b.top + scrollY, c.t)
      const rr = Math.min(b.right + scrollX, c.r), bb = Math.min(b.bottom + scrollY, c.b)
      if (rr - l < 2 || bb - t < 4) continue
      items.push({ eid, text: text.slice(0, 60), x: l, y: t, w: rr - l, h: bb - t })
    }
  }
  // Ancestor relation so a label is not compared with its own wrapper.
  const els = [...seen.entries()].filter(([, v]) => v != null)
  const elOf = new Map(els.map(([e, v]) => [v, e]))
  const overlaps = []
  items.sort((a, b) => a.y - b.y)
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      if (b.y > a.y + a.h) break
      if (a.eid === b.eid) continue
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ix <= 2 || iy <= 2 || ix * iy < 6) continue
      // Line boxes of stacked lines touch by a pixel or two (line-height < font box); require real ink overlap.
      if (iy < Math.min(a.h, b.h) * 0.25) continue
      const ea = elOf.get(a.eid), eb = elOf.get(b.eid)
      if (ea.contains(eb) || eb.contains(ea)) continue
      overlaps.push({ a: a.text, b: b.text, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y), depth: Math.round(Math.min(ix, iy)) })
    }
  }
  // Clipped text: an element whose own text overflows a box that hides it (no ellipsis/line-clamp intent).
  const clipped = []
  for (const [el] of els) {
    const cs = getComputedStyle(el)
    const hides = (v) => v === 'hidden' || v === 'clip'
    if (!(hides(cs.overflowX) || hides(cs.overflow))) continue
    if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) continue
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const b = el.getBoundingClientRect()
      clipped.push({ text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, by: el.scrollWidth - el.clientWidth })
    }
  }
  // Text that runs past the viewport's right edge.
  const offscreen = items.filter((t) => t.x + t.w > innerWidth + 2 || t.x < -2).slice(0, 20).map((t) => ({ text: t.text, x: t.x, y: t.y, w: t.w, h: t.h }))
  const sw = document.scrollingElement.scrollWidth
  return { overlaps, clipped, offscreen, hScroll: sw > innerWidth + 1 ? sw - innerWidth : 0, height: document.scrollingElement.scrollHeight }
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const report = []
for (const mode of MODES) {
  for (const route of ROUTES) {
    for (const w of WIDTHS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce' })
        if (mode === 'demo') await ctx.addCookies([{ name: 'piste-mode', value: 'demo', url: BASE }])
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
        await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(String(e).slice(0, 200)))
        // Scroll through so lazy/in-view content renders, then back to the top.
        await page.evaluate(async () => {
          for (let y = 0; y < document.scrollingElement.scrollHeight; y += innerHeight * 0.8) {
            scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 60))
          }
          scrollTo(0, 0)
        })
        await page.waitForTimeout(500)
        const m = await page.evaluate(measure)
        const tag = `${mode}${route.replace(/[^a-z0-9]+/gi, '_')}-${w}-${theme}`
        const findings = [...m.overlaps.map((o) => ({ kind: 'overlap', ...o })), ...m.clipped.map((o) => ({ kind: 'clipped', ...o })), ...m.offscreen.map((o) => ({ kind: 'offscreen', ...o }))]
        let k = 0
        for (const f of findings.slice(0, 12)) {
          const pad = 40
          const clip = { x: Math.max(0, f.x - pad), y: Math.max(0, f.y - pad), width: Math.min(w, f.w + pad * 2), height: Math.min(600, f.h + pad * 2) }
          clip.width = Math.min(clip.width, w - clip.x)
          if (clip.width > 4 && clip.height > 4) {
            f.png = `${tag}-${k++}.png`
            await page.screenshot({ path: path.join(OUT, f.png), clip, fullPage: true }).catch(() => (f.png = null))
          }
        }
        report.push({ mode, route, width: w, theme, hScroll: m.hScroll, errors: errors.filter((e) => !/ERR_TUNNEL|net::/.test(e)), findings })
        const n = findings.length + (m.hScroll ? 1 : 0)
        console.log(`${n ? '✗' : '✓'} ${tag}${m.hScroll ? ` hscroll+${m.hScroll}` : ''}${findings.length ? ` ${findings.length} finding(s): ${findings.slice(0, 3).map((f) => f.kind + ' "' + (f.a ?? f.text) + '"' + (f.b ? ' × "' + f.b + '"' : '')).join('; ')}` : ''}`)
        await ctx.close()
      }
    }
  }
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.findings.length || r.hScroll)
console.log(`\n${bad.length} of ${report.length} page views have findings → ${path.join(OUT, 'report.json')}`)
