/**
 * Journey 8 — An upstream outage during a refresh keeps the last good data and shows a visible error state.
 *
 * The web server reaches the internet only through a closed local proxy port (playwright.config.ts), so every live
 * provider fails fast with "connection refused" — the same outcome as the sandbox's blocked network, but
 * deterministic anywhere. Live mode: store a report (the last good data), refresh from Sources & Sync and from the
 * resort page, then check the failure is shown, "last success" did not advance, and the stored report is still shown.
 *
 * Manual refreshes have a 10-minute cooldown per job and resort, so this journey runs once per server (desktop).
 */
import { expect, test } from './fixtures'
import { enterManualReport, reveal, toast } from './helpers'

test('a failed refresh never replaces the last good report and says so', async ({ page }) => {
  test.slow()
  // The last good data: a report typed in from the official page.
  await page.goto('/resorts/greek-peak')
  await enterManualReport(page, {
    sourceUrl: 'https://www.greekpeak.net/ski-ride/current-conditions/',
    sourceName: 'Greek Peak conditions page (e2e)',
    snow24: '3',
    base: '18',
  })
  const stored = async () => {
    const report = page.getByRole('region', { name: 'Snow report' })
    await expect(report.getByRole('table', { name: /Reported snowfall/ }).getByRole('row', { name: /24 hours/ })).toContainText('3″')
    await expect(report).toContainText('18″')
  }
  await stored()

  // Sources & Sync: refresh the official snow reports by hand while every upstream is unreachable.
  await page.goto('/sources')
  const job = page
    .getByRole('region', { name: 'Refresh jobs' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Official snow reports', exact: true }) })
  const lastSuccess = job.getByText('Last success', { exact: true }).first().locator('xpath=following-sibling::*[1]')
  const before = (await lastSuccess.innerText()).trim()
  await job.getByRole('button', { name: 'Refresh official snow reports', exact: true }).click()
  await expect(job.getByText(/^Failed: .*Last success is unchanged\.$/)).toBeVisible({ timeout: 45_000 })
  await expect(toast(page, /Refresh official snow reports: Failed/)).toBeVisible()

  // The failure is visible everywhere it matters, and the last success did not move.
  await expect(job).toContainText(/Failing/)
  await expect(job).toContainText(/failed · manual/)
  await expect(job).toContainText(/greekpeak\.net/)
  await expect(lastSuccess).toHaveText(before)
  const greekPeak = (await reveal(job.getByText('Greek Peak', { exact: true }))).locator('xpath=ancestor::li[1]')
  await expect(greekPeak).toContainText(/Failing/)
  await expect(greekPeak.getByText('Last success', { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText(/^never$/i)
  // The status board at the top names the failing job.
  await expect(page.getByRole('link', { name: /^Refresh jobs [1-9]\d* failing .*Official snow reports/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Failures' })).toContainText(/greekpeak\.net/)
  await page.reload()
  await expect(lastSuccess).toHaveText(before)

  // The resort page: the stored report is still shown, the feed says it is failing, and "Fetch now" fails the same
  // way without overwriting anything.
  await page.goto('/resorts/greek-peak')
  await stored()
  const feeds = page.getByRole('region', { name: 'Data feeds' })
  await expect(feeds).toContainText(/Official report/)
  await expect(feeds).toContainText(/Failing/)
  await feeds.getByRole('button', { name: 'Fetch now' }).click()
  await expect(feeds.getByText(/Official report: fetch failed .* nothing stored was overwritten/)).toBeVisible({ timeout: 45_000 })
  await expect(feeds.getByText(/Weather: fetch failed/)).toBeVisible()
  await stored()
  await page.reload()
  await stored()
  await expect(page.getByRole('region', { name: 'Data feeds' })).toContainText(/Failing/)
  await expect(page.getByRole('region', { name: /^Weather on / })).toContainText(/not fetched|fetch failed|failing|could not/i)
})
