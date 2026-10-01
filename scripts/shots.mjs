// Screenshot helper for visual review: node scripts/shots.mjs <baseUrl> <outDir> <path...>
// Use http://localhost:<port> (not 127.0.0.1): Next 16 dev blocks the HMR socket for other origins, so pages would not hydrate.
// Captures 390 / 768 / 1440 widths in light and dark. Uses PLAYWRIGHT_CHROMIUM_PATH if set.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const [base = 'http://localhost:3000', out = 'shots', ...paths] = process.argv.slice(2)
const widths = (process.env.SHOT_WIDTHS ?? '390,768,1440').split(',').map(Number)
const themes = (process.env.SHOT_THEMES ?? 'light,dark').split(',')
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
for (const p of paths.length ? paths : ['/']) {
  for (const w of widths) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: theme, deviceScaleFactor: 1 })
      if (process.env.SHOT_DEMO) await ctx.addCookies([{ name: 'piste-mode', value: 'demo', url: base }])
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      await page.goto(base + p, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push(String(e)))
      await page.waitForTimeout(600)
      const name = `${p.replace(/[^a-z0-9]+/gi, '_') || 'root'}-${w}-${theme}.png`
      await page.screenshot({ path: path.join(out, name), fullPage: process.env.SHOT_FULL !== '0' })
      if (errors.length) console.log(`[${name}] errors:\n  ` + errors.slice(0, 5).join('\n  '))
      console.log('saved', name)
      await ctx.close()
    }
  }
}
await browser.close()
