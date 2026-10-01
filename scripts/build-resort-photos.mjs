#!/usr/bin/env node
/**
 * Find one freely licensed photo per catalog resort on Wikimedia Commons, download it ONCE, and bundle it as
 * src/assets/photo-<id>.webp (1280 px wide), recording credit + licence in the catalog's `photo` field:
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-resort-photos.mjs              # resorts without a photo
 *   NODE_USE_ENV_PROXY=1 node scripts/build-resort-photos.mjs --force alta
 *
 * Order: the resort's English Wikipedia lead image (title from the catalog's Wikipedia link, else a search), then
 * Commons files geotagged within 8 km. Only CC0, public domain, CC BY and CC BY-SA files are used; maps, logos,
 * diagrams and SVGs are skipped. The catalog photo `src` is "asset:photo-<id>.webp" (resolved by src/lib/ui/assets).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAT = path.join(ROOT, 'catalog', 'resorts')
const OUT = path.join(ROOT, 'src', 'assets')
const UA = 'Piste/0.1 (personal ski planner; one-off photo build)'
const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(host, params) {
  const u = new URL(`https://${host}/w/api.php`)
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })) u.searchParams.set(k, v)
  for (let i = 0; i < 4; i++) {
    const res = await fetch(u, { headers: { 'user-agent': UA } })
    if (res.ok) return res.json()
    await sleep(3000 * (i + 1))
  }
  throw new Error(`${host} ${params.action} failed`)
}

const FREE = /^(cc0|public domain|pd|cc[- ]by(-sa)?[- ]?\d(\.\d)?|cc[- ]by(-sa)?)/i
const SKIP = /\b(map|plan|logo|diagram|chart|locator|svg|piste ?map|trail ?map|panorama map|icon|flag|coat of arms|signage|sign)\b/i
const strip = (html) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function fileInfo(title) {
  const d = await api('commons.wikimedia.org', { action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1600' })
  const p = d.query?.pages?.[0]
  const ii = p?.imageinfo?.[0]
  if (!ii) return null
  const m = ii.extmetadata ?? {}
  const license = strip(m.LicenseShortName?.value)
  if (!FREE.test(license)) return null
  if (!/^image\/(jpeg|png|webp)$/.test(ii.mime) || ii.width < 900 || ii.height > ii.width * 1.1) return null
  if (SKIP.test(title) || SKIP.test(strip(m.ImageDescription?.value).slice(0, 200))) return null
  return {
    title,
    url: ii.thumburl ?? ii.url,
    page: ii.descriptionurl,
    license,
    credit: strip(m.Artist?.value) || strip(m.Credit?.value) || 'Wikimedia Commons contributor',
    desc: strip(m.ImageDescription?.value).slice(0, 140),
  }
}

async function wikipediaTitle(r) {
  const m = JSON.stringify(r).match(/https:\/\/en\.wikipedia\.org\/wiki\/([^"#?]+)/)
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ')
  const d = await api('en.wikipedia.org', { action: 'query', list: 'search', srsearch: `${r.name} ski`, srlimit: '5' })
  const words = (r.shortName || r.name).toLowerCase().split(/[\s-]+/).filter((w) => w.length > 2)
  const hit = (d.query?.search ?? []).find((s) => words.some((w) => s.title.toLowerCase().includes(w)))
  return hit?.title ?? null
}

async function leadImage(title) {
  const d = await api('en.wikipedia.org', { action: 'query', titles: title, prop: 'pageimages', piprop: 'name', redirects: '1' })
  const name = d.query?.pages?.[0]?.pageimage
  return name ? `File:${name}` : null
}

async function nearby(r) {
  const { lat, lon } = r.location
  const d = await api('commons.wikimedia.org', { action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: '8000', gsnamespace: '6', gslimit: '60' })
  const words = [(r.shortName || r.name), 'ski', 'piste', 'slope', 'lift', 'gondola', 'chair', 'winter', 'snow'].map((w) => w.toLowerCase())
  const score = (t) => words.reduce((s, w) => s + (t.toLowerCase().includes(w) ? 1 : 0), 0)
  return (d.query?.geosearch ?? []).map((g) => g.title).filter((t) => /\.(jpe?g|png|webp)$/i.test(t)).sort((a, b) => score(b) - score(a))
}

async function photoFor(r) {
  const tried = new Set()
  const title = await wikipediaTitle(r).catch(() => null)
  const lead = title ? await leadImage(title).catch(() => null) : null
  const candidates = [...(lead ? [lead] : []), ...(await nearby(r).catch(() => []))]
  for (const c of candidates) {
    if (tried.has(c)) continue
    tried.add(c)
    const info = await fileInfo(c).catch(() => null)
    if (info) return info
    if (tried.size > 25) break
  }
  return null
}

const files = fs.readdirSync(CAT).filter((f) => f.endsWith('.json'))
const missing = []
for (const f of files) {
  const file = path.join(CAT, f)
  const raw = fs.readFileSync(file, 'utf8')
  const r = JSON.parse(raw)
  if (only.length && !only.includes(r.id)) continue
  if (r.photo && !force) continue
  try {
    const p = await photoFor(r)
    if (!p) {
      missing.push(r.id)
      console.warn(`${r.id}: no freely licensed photo found`)
      continue
    }
    const res = await fetch(p.url, { headers: { 'user-agent': UA } })
    if (!res.ok) throw new Error(`download HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const name = `photo-${r.id}.webp`
    const info = await sharp(buf).rotate().resize({ width: 1280, height: 860, fit: 'cover', position: 'attention' }).webp({ quality: 72 }).toFile(path.join(OUT, name))
    r.photo = {
      src: `asset:${name}`,
      alt: p.desc ? `${r.shortName || r.name}: ${p.desc}` : `${r.shortName || r.name}, photo from Wikimedia Commons`,
      credit: p.credit.slice(0, 120),
      license: p.license,
      sourceUrl: p.page,
    }
    // Keep the file's own formatting: replace only the photo field.
    const next = raw.replace(/"photo":\s*(null|\{[^}]*\})/, `"photo": ${JSON.stringify(r.photo, null, 2).replace(/\n/g, '\n  ')}`)
    fs.writeFileSync(file, next === raw ? JSON.stringify(r, null, 2) + '\n' : next)
    console.log(`${r.id}: ${p.title} (${p.license}, ${p.credit.slice(0, 40)}) → ${(info.size / 1024).toFixed(0)} KB`)
  } catch (e) {
    missing.push(r.id)
    console.warn(`${r.id}: FAILED ${e.message}`)
  }
  await sleep(500)
}
if (missing.length) console.warn(`No photo: ${missing.join(' ')}`)
