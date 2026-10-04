#!/usr/bin/env node
/**
 * Re-check the single-file build in headless Chromium, opened from its file:// URL (no server):
 *   node standalone/verify.mjs [--shots <dir>] [--no-demo] [--chromium <path>]
 *
 * 1. Cold start (fresh browser profile) and every route in live mode, with no page errors.
 * 2. Interactions: Explore filters in the URL (survive reload), resort section nav, create a trip and add an item,
 *    log a ski day, units + currency, theme; a reload keeps everything (IndexedDB).
 * 3. Exports: a trip's ICS download and "Download my data" (a SQLite file).
 * 4. Maps: MapLibre starts from the Blob worker and draws a style (served by the test, the sandbox has no network).
 *    OpenStreetMap lifts & runs load on demand from a resort page, from Overpass fixtures served by the test.
 * 5. Demo: generation from the UI (timed), every route in demo mode, then back to live with live data unchanged.
 * Screenshots (390 and 1440 px, light and dark) of Today, Explore, a resort, Trips and Season with --shots.
 * Expected network failures (the in-page scheduler calling weather APIs without internet) are not counted as errors.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILE = pathToFileURL(path.join(HERE, 'index.html')).href
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const SHOTS = opt('--shots')
const EXECUTABLE = opt('--chromium') ?? process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const DEMO = !args.includes('--no-demo')

const ROUTES = [
  '#/',
  '#/explore',
  '?ids=greek-peak,alta#/explore/compare',
  '#/explore/events',
  '#/forecast',
  '#/resorts/greek-peak',
  '#/resorts/alta',
  '#/trips',
  '#/passes',
  '#/passes/products',
  '#/passes/costs',
  '#/passes/compare',
  '#/passes/rules/ikon-pass-2026-27/alta',
  '#/season',
  '#/settings',
  '#/sources',
]
const NOT_FOUND = { '#/resorts/no-such-resort': 'Resort not found', '#/trips/no-such-trip': 'Trip not found', '#/no/such/page': 'Off the map' }
const EXPECTED_NETWORK = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|ERR_PROXY|ERR_ADDRESS_UNREACHABLE|ERR_FAILED/

const results = []
const facts = {}
const TMP = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'piste-verify-'))
let liveDbFile = ''
async function step(name, fn) {
  const t = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - t, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t} ms)`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, note: e.message.split('\n')[0] })
    console.log(`  ✗ ${name} — ${e.message.split('\n').slice(0, 3).join(' | ')}`)
  }
}

function watch(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED_NETWORK.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`)
  })
  return errors
}

async function ready(page, timeout = 180_000) {
  await page.waitForFunction(() => document.documentElement.dataset.pisteReady === 'true', null, { timeout })
}

/** Open a URL in a fresh tab of the context and wait for the app. */
async function open(ctx, hash, { width } = {}) {
  const page = await ctx.newPage()
  if (width) await page.setViewportSize({ width, height: 900 })
  const errors = watch(page)
  await page.goto(FILE + hash)
  await ready(page)
  return { page, errors }
}

/** Save pending changes now (what closing the tab does), then close. */
async function done(page) {
  await page.evaluate(() => window.__piste?.flush?.())
  await page.close()
}

async function checkRoutes(ctx, label) {
  const bad = []
  for (const r of ROUTES) {
    const { page, errors } = await open(ctx, r)
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim()
    if (!h1 || /could not be loaded|went wrong|could not start/i.test(h1) || errors.length) bad.push(`${r} (${h1 || 'no h1'}${errors.length ? `; ${errors[0]}` : ''})`)
    await page.close()
  }
  for (const [r, heading] of Object.entries(NOT_FOUND)) {
    const { page } = await open(ctx, r)
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim()
    if (h1 !== heading) bad.push(`${r} showed "${h1}" instead of "${heading}"`)
    await page.close()
  }
  if (bad.length) throw new Error(`${label}: ${bad.join('; ')}`)
  return `${ROUTES.length} routes + ${Object.keys(NOT_FOUND).length} not-found views`
}

async function screenshots(ctx, tag) {
  if (!SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  const targets = [
    ['today', '#/'],
    ['explore', '#/explore'],
    ['resort', '#/resorts/greek-peak'],
    ['trips', '#/trips'],
    ['season', '#/season'],
  ]
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const page = await ctx.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 })
      for (const [name, hash] of targets) {
        await page.goto(FILE + hash)
        await ready(page)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(700)
        await page.screenshot({ path: path.join(SHOTS, `${tag}-${name}-${width}-${scheme}.png`) })
      }
      await page.close()
    }
  }
}

async function main() {
  console.log(`Verifying ${FILE}`)
  facts.sizeMB = +(fs.statSync(new URL(FILE)).size / 1024 / 1024).toFixed(2)
  const browser = await chromium.launch({ executablePath: EXECUTABLE })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  // Theme is a stored preference: the system scheme is emulated per screenshot.

  await step('cold start (empty browser storage)', async () => {
    const page = await ctx.newPage()
    const errors = watch(page)
    const t = Date.now()
    await page.goto(FILE)
    await ready(page)
    facts.coldStartMs = Date.now() - t
    facts.bootTimings = await page.evaluate(() => window.__piste?.timings)
    await page.close()
    if (errors.length) throw new Error(errors[0])
    return `${facts.coldStartMs} ms to first render (${JSON.stringify(facts.bootTimings)})`
  })

  await step('warm start (saved data)', async () => {
    const page = await ctx.newPage()
    const t = Date.now()
    await page.goto(FILE)
    await ready(page)
    facts.warmStartMs = Date.now() - t
    await page.close()
    return `${facts.warmStartMs} ms`
  })

  await step('every route renders in live mode', () => checkRoutes(ctx, 'live'))

  await step('Explore filters live in the URL query and survive a reload', async () => {
    const { page } = await open(ctx, '#/explore')
    const search = page.getByPlaceholder('Search resorts, towns, regions').first()
    await search.fill('alta')
    await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === 'alta')
    if (!page.url().includes('#/explore')) throw new Error(`route lost: ${page.url()}`)
    await page.reload()
    await ready(page)
    await expect(page.getByPlaceholder('Search resorts, towns, regions').first()).toHaveValue('alta')
    const url = page.url()
    await done(page)
    return url.slice(url.indexOf('?'))
  })

  await step('resort section nav scrolls without changing the route', async () => {
    const { page } = await open(ctx, '#/resorts/alta')
    const nav = page.getByRole('navigation', { name: 'Resort sections' })
    await nav.getByRole('link', { name: /Conditions/ }).first().click()
    await page.waitForFunction(() => location.hash.startsWith('#/resorts/alta#'))
    const hash = new URL(page.url()).hash
    const section = hash.split('#').pop()
    // Smooth scrolling: wait until the section has reached the top of the viewport.
    await page.waitForFunction((id) => window.scrollY > 200 && Math.abs(document.getElementById(id)?.getBoundingClientRect().top ?? 999) < 200, section, { timeout: 10_000 })
    const y = await page.evaluate(() => window.scrollY)
    const h1 = await page.locator('h1').first().innerText()
    await page.close()
    if (!/Alta/.test(h1)) throw new Error(`route changed: h1 ${h1}`)
    return `${hash}, scrolled to ${y}px`
  })

  await step('resort Back link returns to the page you came from (history)', async () => {
    const { page } = await open(ctx, '#/sources')
    // An in-app navigation made by app code with history.pushState (translated by the runtime).
    await page.evaluate(() => window.history.pushState(null, '', '/resorts/alta'))
    await expect(page.locator('h1').first()).toHaveText('Alta Ski Area', { timeout: 30_000 })
    const back = page.getByRole('link', { name: /Sources/ }).filter({ has: page.locator('svg') }).first()
    await back.click()
    await expect(page.locator('h1').first()).toHaveText('Sources & Sync', { timeout: 30_000 })
    const url = page.url()
    await page.close()
    return `back to ${url.slice(url.indexOf('#'))}`
  })

  let tripHash = ''
  await step('create a trip and add an item', async () => {
    const { page, errors } = await open(ctx, '#/trips')
    await page.getByRole('button', { name: /^(New trip|Plan a trip)$/ }).filter({ visible: true }).first().click()
    const sheet = page.getByRole('dialog', { name: 'New trip' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('group', { name: 'Upcoming weekends' }).getByRole('button').first().click()
    await sheet.getByRole('textbox', { name: /^Name/ }).fill('Verify weekend')
    await sheet.getByRole('button', { name: /Choose resorts/ }).click()
    await sheet.getByRole('textbox', { name: /Where are you skiing/ }).fill('Greek Peak')
    await sheet.getByRole('list', { name: 'Resorts' }).getByRole('button', { name: /Greek Peak/ }).first().click()
    await sheet.getByRole('button', { name: 'Create trip' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Verify weekend' })).toBeVisible({ timeout: 30_000 })
    tripHash = new URL(page.url()).hash
    const events = page.getByRole('region', { name: 'Events' })
    await events.getByRole('button', { name: 'Your own event' }).click()
    const add = page.getByRole('dialog', { name: 'Add event' })
    await add.getByRole('textbox', { name: 'Title' }).fill('Verify après')
    await add.getByRole('button', { name: 'Add to trip', exact: true }).click()
    await expect(add).toBeHidden()
    await expect(events.getByRole('button', { name: 'Verify après', exact: true })).toBeVisible()
    await done(page)
    if (errors.length) throw new Error(errors[0])
    return tripHash
  })

  await step('log a ski day', async () => {
    const { page, errors } = await open(ctx, '#/season')
    await page.getByRole('button', { name: 'Log a ski day' }).filter({ visible: true }).first().click()
    const sheet = page.getByRole('dialog', { name: 'Log a ski day' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('combobox', { name: 'Resort' }).selectOption({ label: 'Greek Peak Mountain Resort' })
    await sheet.getByRole('button', { name: 'Log this day' }).click()
    await expect(sheet).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole('main')).toContainText('Greek Peak')
    await done(page)
    if (errors.length) throw new Error(errors[0])
  })

  await step('change units and currency, switch theme', async () => {
    const { page, errors } = await open(ctx, '#/settings#units')
    const units = page.getByRole('region', { name: 'Units & currency' })
    const pick = async (group, value) => {
      const radio = units.getByRole('radiogroup', { name: group }).getByRole('radio', { name: value, exact: true })
      await radio.click()
      await expect(radio).toHaveAttribute('aria-checked', 'true')
    }
    await pick('Temperature', '°C')
    await pick('Distance', 'km')
    const currency = units.getByRole('radiogroup', { name: 'Display currency' })
    const other = currency.getByRole('radio').filter({ hasNotText: 'USD' }).first()
    const code = (await other.innerText()).trim().split(/\s/)[0]
    await other.click()
    await expect(other).toHaveAttribute('aria-checked', 'true')
    const note = `°C, km, ${code}`
    const theme = page.getByRole('radiogroup', { name: 'Theme' })
    await theme.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await done(page)
    if (errors.length) throw new Error(errors[0])
    return `${note}, dark theme`
  })

  await step('reload: trip, ski day, units and theme persisted (IndexedDB)', async () => {
    const page = await ctx.newPage()
    await page.goto(FILE + tripHash)
    // The theme is applied before first paint from the cached preference.
    const early = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await ready(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Verify weekend' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Events' }).getByRole('button', { name: 'Verify après', exact: true })).toBeVisible()
    await page.goto(FILE + '#/season')
    await ready(page)
    await expect(page.getByRole('main')).toContainText('Greek Peak')
    await page.goto(FILE + '#/settings')
    await ready(page)
    await expect(page.getByRole('radiogroup', { name: 'Temperature' }).getByRole('radio', { name: '°C', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.close()
    if (early !== 'dark') throw new Error(`theme before first paint: ${early}`)
    return 'theme applied before first paint'
  })

  await step('ICS export from the trip downloads a calendar file', async () => {
    const { page } = await open(ctx, tripHash)
    const link = page.locator('a[href*="/api/export/ics?trip="]').first()
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
    const file = await download.path()
    const text = fs.readFileSync(file, 'utf8')
    await page.close()
    if (!text.startsWith('BEGIN:VCALENDAR') || !text.includes('Verify')) throw new Error(`unexpected ICS: ${text.slice(0, 80)}`)
    return `${download.suggestedFilename()} (${text.split('BEGIN:VEVENT').length - 1} events)`
  })

  await step('CSV export (GET form) and JSON export download', async () => {
    const { page } = await open(ctx, '#/season#export')
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .csv' }).click()])
    const csvText = fs.readFileSync(await csv.path(), 'utf8')
    const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download .json' }).click()])
    const data = JSON.parse(fs.readFileSync(await json.path(), 'utf8'))
    await page.close()
    if (!csvText.includes('Greek Peak') && !csvText.includes('greek-peak')) throw new Error('ski-day CSV does not contain the logged day')
    return `${csv.suggestedFilename()}, ${json.suggestedFilename()} (${Object.keys(data).length} keys)`
  })

  await step('"Download my data" is a valid SQLite database', async () => {
    const { page } = await open(ctx, '#/settings#export')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data (.db)' }).first().click()])
    const bytes = fs.readFileSync(await download.path())
    await page.close()
    const header = bytes.subarray(0, 16).toString('latin1')
    if (header !== 'SQLite format 3\u0000') throw new Error(`header ${JSON.stringify(header)}`)
    facts.liveDbKB = Math.round(bytes.length / 1024)
    liveDbFile = path.join(TMP, 'piste-live.db')
    fs.writeFileSync(liveDbFile, bytes)
    return `${download.suggestedFilename()} — ${facts.liveDbKB} kB`
  })

  await step('"Import a .db file" accepts a Piste database and rejects anything else', async () => {
    const { page } = await open(ctx, '#/settings#export')
    const junk = path.join(TMP, 'not-a-database.db')
    fs.writeFileSync(junk, 'hello')
    const input = page.locator('input[type=file][aria-label^="Choose a Piste database"]').first()
    await input.setInputFiles(junk)
    await page.getByRole('button', { name: 'Replace live data' }).click()
    await expect(page.getByText('This is not a SQLite database file.')).toBeVisible()
    await input.setInputFiles(liveDbFile)
    await page.getByRole('button', { name: 'Replace live data' }).click()
    await expect(page.getByText(/^Imported piste-live\.db/)).toBeVisible({ timeout: 30_000 })
    await page.goto(FILE + '#/trips')
    await ready(page)
    await expect(page.getByRole('main')).toContainText('Verify weekend')
    await page.close()
    return 'junk rejected; exported database re-imported, trips intact'
  })

  await step('a second tab takes over; the first saves its last change and steps back', async () => {
    const a = await open(ctx, '#/settings#units')
    const radio = (page, value) => page.getByRole('region', { name: 'Units & currency' }).getByRole('radiogroup', { name: 'Temperature' }).getByRole('radio', { name: value, exact: true })
    await radio(a.page, '°F').click()
    await expect(radio(a.page, '°F')).toHaveAttribute('aria-checked', 'true')
    // Immediately open the file again (no time for the debounced save): the handoff must save first.
    const b = await open(ctx, '#/settings#units')
    await expect(a.page.getByRole('heading', { name: 'Piste is open in another tab' })).toBeVisible({ timeout: 15_000 })
    await expect(radio(b.page, '°F')).toHaveAttribute('aria-checked', 'true')
    // And back: "Use Piste here" in the first tab takes over again.
    await a.page.getByRole('button', { name: 'Use Piste here' }).click()
    await ready(a.page)
    await expect(b.page.getByRole('heading', { name: 'Piste is open in another tab' })).toBeVisible({ timeout: 15_000 })
    await radio(a.page, '°C').click()
    await expect(radio(a.page, '°C')).toHaveAttribute('aria-checked', 'true')
    await b.page.close()
    await done(a.page)
    const errors = [...a.errors, ...b.errors]
    if (errors.length) throw new Error(errors[0])
    return 'the change made just before the second tab opened is there; the first tab shows "open in another tab"'
  })

  await step('MapLibre renders from its Blob worker (style served by the test)', async () => {
    const page = await ctx.newPage()
    const errors = watch(page)
    await page.route('https://tiles.openfreemap.org/**', (route) =>
      route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dcebea' } }] }) }),
    )
    await page.goto(FILE + '?view=map#/explore')
    await ready(page)
    await page.locator('.maplibregl-canvas').first().waitFor({ state: 'attached', timeout: 20_000 })
    await page.waitForFunction(() => document.querySelectorAll('.maplibregl-marker').length > 0, null, { timeout: 20_000 })
    const markers = await page.locator('.maplibregl-marker').count()
    const schematic = await page.getByText('Schematic view').count()
    await page.close()
    if (schematic) throw new Error('fell back to the schematic map')
    if (errors.length) throw new Error(errors[0])
    return `${markers} markers on a live MapLibre canvas`
  })

  await step('Lifts & runs load from OpenStreetMap on demand (Overpass served by the test)', async () => {
    const page = await ctx.newPage()
    const errors = watch(page)
    const fixture = (name) => fs.readFileSync(path.join(HERE, '..', 'src', 'lib', 'providers', 'osm', '__fixtures__', name), 'utf8')
    // Only this resort's requests are answered: the in-page scheduler's own loads (favourites) stay offline.
    const base = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'catalog', 'resorts', 'ski-arlberg.json'), 'utf8')).weatherPoints[0]
    const mark = `${base.lat.toFixed(5)},${base.lon.toFixed(5)}`
    const asked = []
    await page.route('https://overpass-api.de/**', (route) => {
      const q = decodeURIComponent((route.request().postData() ?? '').replace(/^data=/, ''))
      const kind = q.includes('out tags bb') ? 'sites' : q.includes('map_to_area') ? 'area' : 'bbox'
      if (kind === 'sites' && !q.includes(mark)) return route.abort()
      asked.push(kind)
      const name = kind === 'sites' ? 'overpass-arlberg-sites.json' : kind === 'area' ? 'overpass-arlberg-area-empty.json' : 'overpass-arlberg-bbox.json'
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fixture(name) })
    })
    await page.goto(FILE + '#/resorts/ski-arlberg')
    await ready(page)
    const section = page.getByRole('region', { name: 'Lifts & runs' })
    await expect(section.getByText(/Not loaded yet/)).toBeVisible()
    await section.getByRole('button', { name: 'Load lifts & runs from OpenStreetMap' }).click()
    await expect(section.getByText('Galzigbahn', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(section.getByText(/1 green · 2 blue · 1 red · 1 black · 2 freeride \/ itinerary/)).toBeVisible()
    await expect(section.getByRole('link', { name: /© OpenStreetMap contributors/ })).toBeVisible()
    await page.close()
    if (errors.length) throw new Error(errors[0])
    return `requests: ${asked.join(', ')} — lifts listed, runs in European colours, attribution shown`
  })

  await screenshots(ctx, 'live')

  if (DEMO) {
    await step('switch to demo: generation completes and Today shows the in-season pick', async () => {
      const { page, errors } = await open(ctx, '#/')
      const t = Date.now()
      await page.getByRole('button', { name: 'Explore demo mode' }).filter({ visible: true }).first().click()
      await expect(page.getByRole('region', { name: 'Demo mode notice' })).toBeVisible({ timeout: 300_000 })
      await expect(page.getByRole('dialog', { name: /demo/i })).toBeHidden({ timeout: 60_000 })
      facts.demoGenerationMs = Date.now() - t
      const where = page.getByRole('region', { name: /^Where to ski/ })
      await expect(where).toContainText(/Reported open/)
      const pick = (await where.getByRole('heading', { level: 3 }).first().innerText()).trim()
      await page.close()
      if (errors.length) throw new Error(errors[0])
      return `${facts.demoGenerationMs} ms; pick: ${pick}`
    })
    await step('every route renders in demo mode (incl. a demo trip)', async () => {
      const note = await checkRoutes(ctx, 'demo')
      const { page, errors } = await open(ctx, '#/trips/demo-greek-peak-saturday')
      const h1 = await page.locator('h1').first().innerText()
      await page.close()
      if (errors.length || !/Greek Peak/.test(h1)) throw new Error(`demo trip: ${h1} ${errors[0] ?? ''}`)
      return `${note}, demo trip "${h1}"`
    })
    await step('a demo database is never imported over live records', async () => {
      const { page } = await open(ctx, '#/settings#export')
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download demo data (.db)' }).first().click()])
      const demoFile = path.join(TMP, 'piste-demo.db')
      fs.copyFileSync(await download.path(), demoFile)
      facts.demoDbMB = +(fs.statSync(demoFile).size / 1024 / 1024).toFixed(1)
      await page.locator('input[type=file][aria-label^="Choose a Piste database"]').first().setInputFiles(demoFile)
      await page.getByRole('button', { name: 'Replace live data' }).click()
      await expect(page.getByText(/This is a demo database/)).toBeVisible({ timeout: 30_000 })
      await page.close()
      return `demo download ${facts.demoDbMB} MB, import refused`
    })
    await screenshots(ctx, 'demo')
    await step('back to live: live data unchanged', async () => {
      const { page } = await open(ctx, '#/settings')
      await page.getByRole('button', { name: /Return to live data|Switch to live/ }).filter({ visible: true }).first().click()
      await expect(page.getByRole('region', { name: 'Demo mode notice' })).toBeHidden({ timeout: 30_000 })
      await page.goto(FILE + '#/trips')
      await ready(page)
      await expect(page.getByRole('main')).toContainText('Verify weekend')
      const demoTrips = await page.getByText('Greek Peak Saturday').count()
      await page.close()
      if (demoTrips) throw new Error('a demo trip is visible in live mode')
      return 'your trip is there; no demo trip leaked'
    })
  }

  await step('without IndexedDB the app still works and says changes will not be kept', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await c.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }))
    const { page, errors } = await open(c, '#/trips')
    await expect(page.getByText(/is not keeping Piste’s data for this file/)).toBeVisible()
    const h1 = await page.locator('h1').first().innerText()
    await c.close()
    if (errors.length) throw new Error(errors[0])
    return `banner shown; "${h1}" rendered from memory`
  })

  await step('data saved by another schema opens a recovery screen, not a crash', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
    const first = await open(c, '#/')
    await first.page.evaluate(() => window.__piste?.flush?.())
    await first.page.close()
    // Another local page (same file:// storage) rewrites the recorded migration hash, as an older build would have.
    const blank = path.join(TMP, 'blank.html')
    fs.writeFileSync(blank, '<!doctype html><title>blank</title>')
    const tamper = await c.newPage()
    await tamper.goto(pathToFileURL(blank).href)
    const changed = await tamper.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('piste-standalone', 1)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const store = (mode) => db.transaction('databases', mode).objectStore('databases')
      const rec = await new Promise((res) => {
        const q = store('readonly').get('live')
        q.onsuccess = () => res(q.result)
      })
      const bytes = rec.bytes
      const text = new TextDecoder('latin1').decode(bytes)
      const at = text.search(/[0-9a-f]{64}/)
      if (at < 0) return false
      for (let i = 0; i < 8; i++) bytes[at + i] = 'deadbeef'.charCodeAt(i)
      await new Promise((res) => {
        const q = store('readwrite').put({ ...rec, bytes }, 'live')
        q.onsuccess = () => res(null)
      })
      return true
    })
    await tamper.close()
    if (!changed) throw new Error('could not find the migration hash in the saved database')
    const page = await c.newPage()
    const errors = watch(page)
    await page.goto(FILE)
    await expect(page.getByRole('heading', { name: 'Your saved data is from another version of this file' })).toBeVisible({ timeout: 30_000 })
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download saved data (.db)' }).click()])
    const saved = fs.readFileSync(await download.path())
    await page.getByRole('button', { name: 'Start fresh' }).click()
    await ready(page)
    const h1 = await page.locator('h1').first().innerText()
    await c.close()
    if (saved.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('the offered download is not a SQLite file')
    if (errors.length) throw new Error(errors[0])
    return `old data downloadable (${Math.round(saved.length / 1024)} kB); "Start fresh" opened ${h1}`
  })

  await browser.close()
  fs.rmSync(TMP, { recursive: true, force: true })
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. File ${facts.sizeMB} MB; facts: ${JSON.stringify(facts)}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
