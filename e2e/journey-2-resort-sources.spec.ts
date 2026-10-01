/**
 * Journey 2 — Open Greek Peak and Alta (live mode) and see sourced facts with their source drawers, an explicit
 * weather state (every live provider is unreachable here, so: not fetched yet, or the fetch failed — never a guess),
 * and, for official data Piste cannot read, working official links plus the manual report entry route.
 */
import { expect, test } from './fixtures'
import { enterManualReport, literal, reveal, submitAndWait, toast } from './helpers'

const RESORTS = [
  { id: 'greek-peak', name: 'Greek Peak Mountain Resort', short: 'Greek Peak', official: /^https:\/\/(www\.)?greekpeak\.net\//, host: 'greekpeak.net' },
  { id: 'alta', name: 'Alta Ski Area', short: 'Alta', official: /^https:\/\/(www\.)?alta\.com\//, host: 'alta.com' },
]

for (const r of RESORTS) {
  test(`${r.short}: sourced facts, an explicit weather state and official links @mobile`, async ({ page }) => {
    await page.goto(`/resorts/${r.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(r.name)

    // A catalog fact opens its source drawer: provider, retrieval, verification and the source link.
    const trigger = await reveal(page.getByRole('button', { name: /^Sources: (Elevation|Location|Terrain)$/, includeHidden: true }))
    const fact = (await trigger.getAttribute('aria-label'))!.replace('Sources: ', '')
    await trigger.click()
    const drawer = page.getByRole('dialog', { name: fact })
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('Where these facts come from')
    await expect(drawer).toContainText(/Retrieved/)
    await expect(drawer).toContainText(/Verification/)
    await expect(drawer).toContainText(/confirm at (the )?source/i)
    const sourceLink = drawer.getByRole('link').first()
    await expect(sourceLink).toHaveAttribute('href', /^https:\/\//)
    await expect(sourceLink).toHaveAttribute('target', '_blank')
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()

    // Weather: an explicit state, and no full score invented without it.
    const weather = page.getByRole('region', { name: /^Weather on / })
    await expect(weather).toContainText(/not fetched|fetch failed|could not be fetched|failing|unavailable/i)
    await expect(page.getByRole('region', { name: 'Piste Conditions' })).toContainText(/No score|Not a full conditions score/)
    const feeds = await reveal(page.getByRole('region', { name: 'Data feeds', includeHidden: true }))
    await expect(feeds).toContainText(/Weather/)
    await expect(feeds).toContainText(/Not fetched yet|Failing|failed/)
    await expect(feeds.getByRole('definition').first()).toHaveText(/^never$/i)

    // Official pages Piste cannot read: https links on the resort's own site, opened safely in a new tab — the
    // official website, and the report page its unverified reader targets.
    await expect(await reveal(page.getByRole('region', { name: 'Maps & links' }).getByRole('link', { name: /^Official website/, includeHidden: true }))).toHaveAttribute('href', r.official)
    await expect(await reveal(feeds.getByRole('link', { name: /Open the page/, includeHidden: true }))).toHaveAttribute('href', r.official)
    const official = page.getByRole('main').locator(`a[href*="${r.host}"]`)
    expect(await official.count(), `links to ${r.host}`).toBeGreaterThan(1)
    for (const link of await official.all()) {
      await expect(link).toHaveAttribute('href', r.official)
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', /noopener/)
    }

    // The manual-edit route for that data: the report form, prefilled with the official page as its source.
    await (await reveal(page.getByRole('button', { name: /Enter an official report/, includeHidden: true }))).click()
    const sheet = page.getByRole('dialog', { name: literal(`Enter a report for ${r.short}`) })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('textbox', { name: 'Source link' })).toHaveValue(r.official)
    await expect(sheet.getByRole('link', { name: /Open the official snow report/ })).toHaveAttribute('href', r.official)
    await expect(sheet.getByRole('button', { name: 'Save report' })).toBeEnabled()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
  })
}

test('a manual report is stored with its source and shown as manual, not official', async ({ page }) => {
  const source = 'https://www.alta.com/conditions'
  await page.goto('/resorts/alta')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alta Ski Area')

  // A missing source link is refused: official figures always carry one.
  await (await reveal(page.getByRole('button', { name: /Enter an official report/, includeHidden: true }))).click()
  const sheet = page.getByRole('dialog', { name: /Enter a report for Alta/ })
  await sheet.getByRole('textbox', { name: 'Source link' }).fill('')
  await sheet.getByRole('textbox', { name: '24 hours', exact: true }).fill('7')
  await submitAndWait(page, sheet.getByRole('button', { name: 'Save report' }))
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('alert').first()).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()

  await enterManualReport(page, { sourceUrl: source, sourceName: 'Alta snow report (typed in by e2e)', snow24: '7', base: '52' })
  await expect(toast(page, /Report saved for Alta/).first()).toBeVisible()

  const report = page.getByRole('region', { name: 'Snow report' })
  await expect(report).toContainText(/typed by you|manual/i)
  await expect(report).not.toContainText(/No snow report on file/)
  const snowfall = report.getByRole('table', { name: /Reported snowfall/ })
  await expect(snowfall.getByRole('row', { name: /24 hours/ })).toContainText('7″')
  await expect(report).toContainText('52″')

  // Its source drawer names the kind (manual) and links the page the figures were typed from.
  await report.getByRole('button', { name: /^Sources: / }).first().click()
  const drawer = page.getByRole('dialog').filter({ hasText: 'Where these facts come from' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(/manual|typed by you|entered by you/i)
  await expect(drawer).not.toContainText(/Read from the official page|Retrieved from a documented API/)
  await expect(drawer.getByRole('link', { name: /alta\.com\/conditions/ })).toHaveAttribute('href', source)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // Every revision is kept, labelled by origin; a reload shows the same stored report.
  await expect(await reveal(page.getByRole('region', { name: 'Report history', includeHidden: true }))).toContainText(/7″ new · 52″ base/)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Snow report' }).getByRole('table', { name: /Reported snowfall/ })).toContainText('7″')
})
