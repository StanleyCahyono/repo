/**
 * Journey 3 — Inspect a past tracked date and tell apart what was forecast then, what was reported, and what Piste
 * estimated then. Demo mode, Forecast history calendar, Greek Peak on Sat 9 Jan 2027.
 */
import { expect, test } from './fixtures'
import { definition, num } from './helpers'

test.use({ mode: 'demo' })

test('a past day in the history calendar separates forecast-then, reported and estimated-then @mobile', async ({ page }) => {
  await page.goto('/forecast')
  await expect(page.getByRole('heading', { level: 1, name: 'Forecast' })).toBeVisible()
  const resorts = page.getByRole('radiogroup', { name: 'Resorts' })
  const greekPeak = resorts.getByRole('radio', { name: 'Greek Peak' })
  if ((await greekPeak.getAttribute('aria-checked')) !== 'true') await greekPeak.click()
  await expect(greekPeak).toHaveAttribute('aria-checked', 'true')

  const history = page.getByRole('region', { name: 'History' })
  await history.scrollIntoViewIfNeeded()
  const calendar = history.getByRole('grid', { name: /History for Greek Peak Mountain Resort, January 2027/ })
  await expect(calendar).toBeVisible()
  // Future days are not tracked yet; past days carry what was reported and estimated.
  await expect(calendar.getByRole('gridcell', { name: /Saturday 16 January 2027: in the future/ })).toBeVisible()
  const day = calendar.getByRole('button', { name: /^Saturday 9 January 2027: / })
  const summary = (await day.getAttribute('aria-label')) ?? (await day.innerText())
  const cellReported = summary.match(/reported last 24 h snowfall ([\d.]+)″/)?.[1]
  const cellEstimate = summary.match(/estimated then (\d+)/)?.[1]
  expect(cellReported, summary).toBeTruthy()
  expect(cellEstimate, summary).toBeTruthy()
  await day.click()

  const sheet = page.getByRole('dialog', { name: 'Sat 9 Jan 2027 · Greek Peak Mountain Resort' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText(/never recomputed/)

  // Forecast then: the stored model run fetched BEFORE the day.
  const forecast = sheet.getByRole('region', { name: 'Forecast then' })
  await expect(forecast).toContainText(/Model/)
  await expect(forecast).toContainText(/fetched Fri 8 Jan.*before the day/)
  const forecastSnow = (await definition(forecast, 'Snowfall').innerText()).trim()
  expect(forecastSnow).toMatch(/^[\d.]+″$/)

  // Reported: the resort's report for that day (a demo report here), with its own snowfall windows.
  const reported = sheet.getByRole('region', { name: 'Reported' })
  await expect(reported).toContainText(/published Sat 9 Jan/)
  const reported24 = (await definition(reported, 'Last 24 h').innerText()).trim()
  expect(reported24).toMatch(/^[\d.]+″/)
  expect(num(reported24.match(/[\d.]+/)![0])).toBe(num(cellReported!))
  // What was forecast is not what was reported — and the page keeps both.
  expect(num(forecastSnow), `forecast ${forecastSnow} vs reported ${reported24}`).not.toBe(num(reported24.match(/[\d.]+/)![0]))
  await expect(reported).toContainText(/Reported later/)

  // Piste estimated then: the score as computed before the day, with when and how.
  const estimate = sheet.getByRole('region', { name: 'Piste estimated then' })
  await expect(estimate).toContainText(new RegExp(`(?<!\\d)${cellEstimate}(?!\\d)`))
  await expect(definition(estimate, 'Computed')).toContainText(/Fri 8 Jan.*ahead/)
  await expect(estimate).toContainText(/later reports never rewrite it/)
  await expect(estimate).toContainText(/suitability, not safety/)

  // The three are distinct sections, each labelled with its own kind of source.
  await expect(forecast).not.toContainText(/published Sat 9 Jan/)
  await expect(reported).not.toContainText(/fetched Fri 8 Jan/)

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(day).toBeFocused()
})
