/**
 * Smoke: every primary route answers 200 in live and demo mode and renders its page heading without page errors,
 * hydration errors or app console errors; unknown resort and trip ids answer a real 404.
 */
import { expect, setMode, test, type Mode } from './fixtures'
import { expectNoHorizontalOverflow } from './helpers'

const ROUTES = [
  '/',
  '/explore',
  '/explore/compare',
  '/explore/events',
  '/forecast',
  '/trips',
  '/passes',
  '/passes/products',
  '/passes/matrix',
  '/passes/costs',
  '/passes/compare',
  '/passes/rules/ikon-pass-2026-27/alta',
  '/season',
  '/settings',
  '/sources',
  '/resorts/greek-peak',
  '/resorts/alta',
]
const DEMO_ONLY = ['/trips/demo-greek-peak-saturday', '/trips/demo-alta-presidents-day']

for (const mode of ['live', 'demo'] as Mode[]) {
  test(`every primary route renders in ${mode} mode @mobile`, async ({ page, baseURL }) => {
    test.slow()
    await setMode(page, mode, baseURL!)
    for (const path of mode === 'demo' ? [...ROUTES, ...DEMO_ONLY] : ROUTES) {
      await test.step(path, async () => {
        const res = await page.goto(path, { waitUntil: 'networkidle' })
        expect(res?.status(), `${mode} ${path}`).toBe(200)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        if (mode === 'demo') await expect(page.getByRole('region', { name: 'Demo mode notice' })).toBeVisible()
        // On the phone project every route must also fit the screen (journey 9 covers the interactions).
        if ((page.viewportSize()?.width ?? 1440) <= 480) await expectNoHorizontalOverflow(page, `${mode} ${path}`)
      })
    }
  })

  test(`unknown resort and trip ids are real 404s in ${mode} mode`, async ({ page, baseURL, consoleErrors }) => {
    // The browser logs the document's own 404 as a failed resource load — that is the expected outcome here.
    consoleErrors.allow(/status of 404 \(Not Found\)/)
    await setMode(page, mode, baseURL!)
    for (const path of ['/resorts/nope', '/trips/nope', '/resorts/greek-peak-nope', '/no-such-page']) {
      await test.step(path, async () => {
        const res = await page.goto(path, { waitUntil: 'networkidle' })
        expect(res?.status(), `${mode} ${path}`).toBe(404)
        await expect(page.getByRole('main')).toContainText(/not found/i)
        // The shell (navigation) stays usable on a 404.
        await expect(page.getByRole('link', { name: 'Explore' }).first()).toBeAttached()
      })
    }
  })
}

test('health endpoint answers in both modes', async ({ request }) => {
  const live = await request.get('/api/health')
  expect(live.status()).toBe(200)
  expect((await live.json()).mode).toBe('live')
  const demo = await request.get('/api/health', { headers: { cookie: 'piste-mode=demo' } })
  expect(demo.status()).toBe(200)
  expect(await demo.json()).toMatchObject({ mode: 'demo', demo: true })
})
