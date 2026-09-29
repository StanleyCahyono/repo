/**
 * Journey 9 — Core pages with keyboard navigation, reduced motion and a narrow mobile width.
 *
 * - Keyboard: Tab through Today, Explore and a resort page, reaching the primary controls in order, each with a
 *   visible focus ring (document.activeElement and its computed outline), operating them with Enter/arrow keys, and
 *   checking that dialogs take focus and give it back.
 * - Reduced motion: with prefers-reduced-motion, sheet animations and transitions collapse to ~0 ms (and run
 *   normally without it).
 * - 390 px (phone project only): every screen, live and demo, has no horizontal overflow, and the phone navigation
 *   (bottom bar with 44 px targets + More sheet) works.
 */
import { expect, setMode, test } from './fixtures'
import { DEMO_ONLY_ROUTES, expectNoHorizontalOverflow, expectVisibleFocus, focused, PRIMARY_ROUTES, reveal, settle, tabUntil } from './helpers'

test('Today, Explore and a resort page are usable from the keyboard with visible focus', async ({ page }) => {
  // Today: the skip link comes first, is visible when focused and moves focus to the content.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  const skip = await tabUntil(page, (f) => f.name === 'Skip to content', 'the skip link', 2)
  expectVisibleFocus(skip, 'Skip to content')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()

  // The date chips are one radio group: Tab lands on the checked chip, arrows choose (and rank) another day.
  const chip = await tabUntil(page, (f) => f.role === 'radio', 'the date chips', 10)
  expectVisibleFocus(chip, `date chip "${chip.name}"`)
  const dates = page.getByRole('radiogroup', { name: 'Dates to rank' })
  await expect(dates.getByRole('radio', { checked: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/[?&]date=\d{4}-\d{2}-\d{2}/)
  await expect(dates.getByRole('radio', { name: /^Tomorrow/ })).toHaveAttribute('aria-checked', 'true')
  await expect(dates.getByRole('radio', { name: /^Tomorrow/ })).toBeFocused()

  // "Pick dates" opens an inline form from the keyboard; its date field shows focus too.
  const pick = await tabUntil(page, (f) => f.name.startsWith('Pick dates'), '"Pick dates"', 5)
  expectVisibleFocus(pick, 'Pick dates')
  await page.keyboard.press('Enter')
  const form = page.getByRole('form', { name: 'Pick dates' })
  await expect(form).toBeVisible()
  const from = await tabUntil(page, (f) => f.tag === 'input', 'the "From" date', 5)
  expectVisibleFocus(from, 'the "From" date field')
  const close = await tabUntil(page, (f) => f.name === 'Close date picker', 'the close button', 10)
  expectVisibleFocus(close, 'Close date picker')
  await page.keyboard.press('Enter')
  await expect(form).toBeHidden()

  // Explore: reach the search box, type, then reach the matching resort and open it with Enter.
  await page.goto('/explore')
  await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible()
  const search = await tabUntil(page, (f) => /^Search resorts/.test(f.name), 'the resort search', 40)
  expectVisibleFocus(search, 'the resort search box')
  await page.keyboard.type('Alta')
  await expect(page.getByRole('article', { name: 'Greek Peak Mountain Resort' })).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Alta Ski Area' })).toBeVisible()
  const result = await tabUntil(page, (f) => f.tag === 'a' && f.name === 'Alta Ski Area', 'the Alta result', 20)
  expectVisibleFocus(result, 'the Alta result link')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/resorts\/alta(\?|$)/)
  await expect(page.getByRole('heading', { level: 1, name: 'Alta Ski Area' })).toBeVisible()

  // Resort page: the primary actions come first; a dialog takes focus and returns it on Escape.
  const compare = await tabUntil(page, (f) => f.tag === 'button' && /^Compare/.test(f.name), 'Compare', 25)
  expectVisibleFocus(compare, 'Compare')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: /^Compare Alta with/ })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((el) => el.contains(document.activeElement)), 'focus moved into the dialog').toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect((await focused(page))?.name, 'focus returned to Compare').toMatch(/^Compare/)
  const addToTrip = await tabUntil(page, (f) => f.tag === 'button' && /^Add to trip/.test(f.name), 'Add to trip', 5)
  expectVisibleFocus(addToTrip, 'Add to trip')
  const section = await tabUntil(page, (f) => f.tag === 'a' && /Conditions$/.test(f.name), 'the Conditions section link', 10)
  expectVisibleFocus(section, 'the section navigation')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#conditions$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Conditions' })).toBeInViewport()
})

test('prefers-reduced-motion collapses sheet animations and transitions @mobile', async ({ page }) => {
  const sheetTiming = async () => {
    await page.goto('/resorts/greek-peak')
    await (await reveal(page.getByRole('button', { name: /^Sources: (Elevation|Location|Terrain)$/, includeHidden: true }))).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    const t = await drawer.evaluate((el) => {
      const s = getComputedStyle(el)
      const button = document.querySelector('main button')
      return { animation: parseFloat(s.animationDuration), transition: button ? parseFloat(getComputedStyle(button).transitionDuration) : NaN }
    })
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    return t
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normal = await sheetTiming()
  expect(normal.animation, 'the drawer animates normally').toBeGreaterThanOrEqual(0.15)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const reduced = await sheetTiming()
  expect(reduced.animation, 'drawer animation with reduced motion').toBeLessThan(0.01)
  expect(reduced.transition, 'button transition with reduced motion').toBeLessThan(0.01)
})

test('every screen fits 390 px without sideways scrolling, and the phone navigation works @phone-only', async ({ page, baseURL }) => {
  expect(page.viewportSize()?.width).toBe(390)
  // Demo mode has the fullest screens (in season, trips, passes, journal); live mode adds preseason Today, onboarding
  // and empty states.
  const sweep: Record<'live' | 'demo', string[]> = {
    demo: [...PRIMARY_ROUTES, ...DEMO_ONLY_ROUTES, '/explore/compare?ids=greek-peak,alta,bristol-mountain'],
    live: ['/', '/explore', '/forecast', '/trips', '/passes', '/season', '/settings', '/sources', '/resorts/alta'],
  }
  for (const mode of ['demo', 'live'] as const) {
    await setMode(page, mode, baseURL!)
    for (const path of sweep[mode]) {
      await test.step(`${mode} ${path}`, async () => {
        const res = await page.goto(path)
        expect(res?.status(), `${mode} ${path}`).toBe(200)
        await settle(page)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        await expectNoHorizontalOverflow(page, `${mode} ${path}`)
      })
    }
  }
  await setMode(page, 'demo', baseURL!)
  await page.goto('/trips/demo-alta-presidents-day')

  // The phone navigation: a bottom bar with the main destinations (44 px targets) and a More sheet for the rest.
  const bar = page.getByRole('navigation', { name: 'Main' }).filter({ has: page.getByRole('button', { name: /^More/ }) })
  await expect(bar).toBeVisible()
  for (const link of await bar.getByRole('link').all()) {
    const box = (await link.boundingBox())!
    expect(box.height, 'bottom-bar targets are at least 44 px tall').toBeGreaterThanOrEqual(44)
  }
  await bar.getByRole('button', { name: /^More/ }).click()
  const more = page.getByRole('dialog', { name: 'More' })
  await expect(more).toBeVisible()
  await more.getByRole('link', { name: 'Passes & Costs' }).click()
  await expect(page).toHaveURL(/\/passes$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Passes & Costs' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your passes' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'demo /passes after navigating from More')
  await bar.getByRole('link', { name: 'Trips' }).click()
  await expect(page).toHaveURL(/\/trips$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Trips' })).toBeVisible()
})
