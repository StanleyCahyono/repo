/**
 * Smoke: every primary route answers 200 in live and demo mode and renders its page heading without page errors,
 * hydration errors or app console errors; unknown resort and trip ids answer a real 404. (The phone project repeats
 * the route sweep at 390 px in journey 9, with an overflow check on every page.)
 */
import { expect, setMode, test, type Mode } from './fixtures'
import { DEMO_ONLY_ROUTES, PRIMARY_ROUTES, settle } from './helpers'

for (const mode of ['live', 'demo'] as Mode[]) {
  test(`every primary route renders in ${mode} mode`, async ({ page, baseURL }) => {
    await setMode(page, mode, baseURL!)
    for (const path of mode === 'demo' ? [...PRIMARY_ROUTES, ...DEMO_ONLY_ROUTES] : PRIMARY_ROUTES) {
      await test.step(path, async () => {
        const res = await page.goto(path)
        expect(res?.status(), `${mode} ${path}`).toBe(200)
        await settle(page)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        if (mode === 'demo') await expect(page.getByRole('region', { name: 'Demo mode notice' })).toBeVisible()
      })
    }
  })

  test(`unknown resort and trip ids are real 404s in ${mode} mode`, async ({ page, baseURL, consoleErrors }) => {
    // The browser logs the document's own 404 as a failed resource load — that is the expected outcome here.
    consoleErrors.allow(/status of 404 \(Not Found\)/)
    await setMode(page, mode, baseURL!)
    for (const path of ['/resorts/nope', '/trips/nope', '/resorts/greek-peak-nope', '/no-such-page']) {
      await test.step(path, async () => {
        const res = await page.goto(path)
        expect(res?.status(), `${mode} ${path}`).toBe(404)
        await settle(page)
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
