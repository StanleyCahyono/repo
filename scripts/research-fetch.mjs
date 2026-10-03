#!/usr/bin/env node
/**
 * Research fetcher (runs in CI, which has open internet): for each item in research/plan.json, runs its web searches
 * (Bing RSS, DuckDuckGo HTML as fallback), then renders the item's known URLs, the most relevant pages of the
 * official site (from its sitemap) and the top search results on the official or allow-listed hosts in Chromium and
 * saves each page's visible text. Output (research-out/):
 *   index.json                      { items: { <id>: { searches: [...], pages: [{ url, title, file, fetched }] } } }
 *   pages/<id-slug>/<n>.txt         "URL: …\nTITLE: …\nFETCHED: …\n\n<visible text>"
 *
 *   node scripts/research-fetch.mjs [--only resort:alta,pass:ikon] [--max-pages 10] [--shard 0/4]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'research-out')
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', 'plan.json'), 'utf8'))
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const ONLY = arg('only', null)?.split(',') ?? null
// --shard k/n: handle every n-th item starting at k (CI runs n shards in parallel).
const [SHARD, SHARDS] = (arg('shard', '0/1')).split('/').map(Number)
const MAX_PAGES = Number(arg('max-pages', '12'))
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
const decodeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

async function get(url, ms = 20000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, signal: c.signal, redirect: 'follow' })
    return res.ok ? await res.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function search(q) {
  const rss = await get(`https://www.bing.com/search?format=rss&setlang=en-US&cc=US&q=${encodeURIComponent(q)}`)
  let results = []
  if (rss) {
    results = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
      title: decodeXml(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      url: decodeXml(m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''),
      snippet: decodeXml(m[1].match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ''),
    }))
  }
  if (!results.length) {
    const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`)
    if (html) {
      results = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => {
        let url = decodeXml(m[1])
        const uddg = url.match(/uddg=([^&]+)/)
        if (uddg) url = decodeURIComponent(uddg[1])
        return { title: decodeXml(m[2].replace(/<[^>]+>/g, '')), url, snippet: decodeXml(m[3].replace(/<[^>]+>/g, '')) }
      })
    }
  }
  return results.slice(0, 10)
}

async function sitemapUrls(h, keywords) {
  if (!h) return []
  const roots = new Set([`https://www.${h}/sitemap.xml`, `https://${h}/sitemap.xml`, `https://www.${h}/sitemap_index.xml`])
  const robots = (await get(`https://www.${h}/robots.txt`, 10000)) ?? (await get(`https://${h}/robots.txt`, 10000))
  for (const m of robots?.matchAll(/^sitemap:\s*(\S+)/gim) ?? []) roots.add(m[1])
  const urls = new Set()
  let budget = 8
  const queue = [...roots]
  while (queue.length && budget-- > 0) {
    const xml = await get(queue.shift(), 15000)
    if (!xml) continue
    for (const m of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)) {
      const u = decodeXml(m[1])
      if (/\.xml(\.gz)?$/.test(u)) {
        if (queue.length < 20 && keywords.some((k) => u.toLowerCase().includes(k)) || /page|post|en/i.test(u)) queue.push(u)
      } else urls.add(u)
    }
  }
  const score = (u) => {
    const l = u.toLowerCase()
    let s = keywords.reduce((n, k) => n + (l.includes(k) ? 1 : 0), 0)
    if (/\/en(\/|-|$)|lang=en/.test(l)) s += 0.5
    if (/\/(de|fr|it|ja|es|nl|ru|zh|ko|pl|cs)\//.test(l)) s -= 0.6
    if (/(news|blog|press|event|job|career|webcam|summer|sommer|ete|estate|bike|golf|hike)/.test(l)) s -= 1
    return s
  }
  return [...urls].filter((u) => score(u) >= 1).sort((a, b) => score(b) - score(a)).slice(0, 8)
}

const browser = await chromium.launch()
const context = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1280, height: 1600 } })
async function render(url) {
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(1200)
    // Expand accordions/tabs that hide price tables.
    await page.evaluate(() => {
      for (const d of document.querySelectorAll('details:not([open])')) d.open = true
    }).catch(() => {})
    const title = await page.title().catch(() => '')
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    return { title, text: text.replace(/\n{3,}/g, '\n\n').slice(0, 80000), final: page.url() }
  } catch (e) {
    return { error: String(e).slice(0, 200) }
  } finally {
    await page.close().catch(() => {})
  }
}

const indexFile = path.join(OUT, 'index.json')
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { items: {} }
fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true })
for (const [i, item] of plan.items.entries()) {
  if (i % SHARDS !== SHARD) continue
  if (ONLY && !ONLY.includes(item.id)) continue
  if (index.items[item.id]?.done) continue
  const rec = { searches: [], pages: [], done: false }
  for (const q of item.queries) {
    const results = await search(q)
    rec.searches.push({ q, results })
    await sleep(1500)
  }
  const want = new Set(item.urls)
  for (const u of await sitemapUrls(item.officialHost, plan.keywords)) want.add(u)
  const allow = new Set([item.officialHost, ...(item.allow ?? [])].filter(Boolean))
  for (const s of rec.searches) {
    let taken = 0
    for (const r of s.results) {
      const h = host(r.url)
      if (taken < 3 && [...allow].some((a) => h === a || h.endsWith(`.${a}`))) {
        want.add(r.url)
        taken++
      }
    }
  }
  const dir = path.join(OUT, 'pages', slug(item.id))
  fs.mkdirSync(dir, { recursive: true })
  let n = 0
  for (const url of [...want].slice(0, MAX_PAGES)) {
    const r = await render(url)
    if (r.error || !r.text || r.text.length < 200) {
      rec.pages.push({ url, error: r.error ?? 'empty page' })
      continue
    }
    const file = path.join(dir, `${String(n++).padStart(2, '0')}-${slug(host(r.final) + new URL(r.final).pathname).slice(0, 80)}.txt`)
    fs.writeFileSync(file, `URL: ${r.final}\nTITLE: ${r.title}\nFETCHED: ${new Date().toISOString()}\n\n${r.text}\n`)
    rec.pages.push({ url: r.final, title: r.title, file: path.relative(OUT, file) })
  }
  rec.done = true
  index.items[item.id] = rec
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1))
  console.log(`${item.id}: ${rec.searches.reduce((a, s) => a + s.results.length, 0)} results, ${rec.pages.filter((p) => p.file).length}/${rec.pages.length} pages`)
}
await browser.close()
