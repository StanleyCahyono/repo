/**
 * Journey 5 — Switch currency and units without corrupting stored values or comparisons. Demo mode (it has weather,
 * trips, a pass purchase and stored USD→CAD/EUR rates). Values are read on Today, a resort page and Passes, the
 * display is switched to °C / cm / km / m / CAD in Settings, every value must convert consistently while the ranking
 * stays the same, and switching back must restore each displayed value exactly.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { definition, num, submitAndWait } from './helpers'

test.use({ mode: 'demo' })

interface Shown {
  day: string
  budget: string
  pick: string
  total: string
  drive: string
  elevation: string
  perDay: string
}

async function readDisplayed(page: Page): Promise<Shown> {
  await page.goto('/')
  const where = page.getByRole('region', { name: /^Where to ski/ })
  const pick = (await where.getByRole('heading', { level: 3, name: /^Top pick:/ }).innerText()).trim()
  const total = (await where.getByRole('row', { name: /^Ranking total/ }).innerText()).trim()
  // Greek Peak's column on today's row of the seven-day table.
  const today = page.getByRole('table', { name: /^Next 7 days by resort/ }).getByRole('row', { name: /^Friday 15 January/ })
  const day = (await today.getByRole('cell').first().innerText()).trim()
  const budget = (await definition(page.getByRole('region', { name: 'Your next saved trip' }), 'Budget').innerText()).trim()

  await page.goto('/resorts/greek-peak')
  const drive = (await page.getByRole('region', { name: /^Drive from/ }).getByText(/^one way · /).innerText()).trim()
  const elevation = (await page.getByRole('main').innerText()).match(/[\d,]+ (ft|m) → [\d,]+ (ft|m)/)?.[0] ?? ''

  await page.goto('/passes')
  const pass = page.getByRole('article', { name: 'Indy Base Pass' })
  const perDay = (await definition(pass, 'Cost per day used').innerText()).trim()
  const shown = { day, budget, pick, total, drive, elevation, perDay }
  for (const [k, v] of Object.entries(shown)) expect(v, k).not.toBe('')
  return shown
}

async function choose(page: Page, choices: [group: string, value: string][]) {
  await page.goto('/settings#units')
  const units = page.getByRole('region', { name: 'Units & currency' })
  for (const [group, value] of choices) {
    const radio = units.getByRole('radiogroup', { name: group }).getByRole('radio', { name: value, exact: true })
    if ((await radio.getAttribute('aria-checked')) === 'true') continue
    await submitAndWait(page, radio)
    await expect(radio).toHaveAttribute('aria-checked', 'true')
  }
}

const METRIC_CAD: [string, string][] = [
  ['Temperature', '°C'],
  ['Snow & precipitation', 'cm'],
  ['Distance', 'km'],
  ['Elevation', 'm'],
  ['Display currency', 'CAD'],
]
const IMPERIAL_USD: [string, string][] = [
  ['Temperature', '°F'],
  ['Snow & precipitation', 'in'],
  ['Distance', 'mi'],
  ['Elevation', 'ft'],
  ['Display currency', 'USD'],
]

const nums = (s: string) => [...s.replace(/[−–](?=\d)/g, '-').matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => num(m[0]))

test('units and currency change only the display, consistently, and switch back exactly @mobile', async ({ page }) => {
  await choose(page, IMPERIAL_USD)
  const before = await readDisplayed(page)
  expect(before.day).toMatch(/snow [\d.]+″; high \/ low -?\d+° \/ -?\d+°/)
  expect(before.perDay).toMatch(/^\$\d/)

  // The stored USD→CAD rate the display uses.
  await page.goto('/settings#units')
  const rateText = await page.getByRole('region', { name: 'Units & currency' }).getByText(/^1 USD = [\d.]+ CAD/).innerText()
  const cadRate = num(rateText.match(/= ([\d.]+) CAD/)![1])

  try {
    await choose(page, METRIC_CAD)
    // The choice is stored: a reload shows it.
    await page.reload()
    for (const [group, value] of METRIC_CAD) {
      await expect(page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: value, exact: true })).toHaveAttribute('aria-checked', 'true')
    }
    const after = await readDisplayed(page)

    // Snow: inches ↔ cm; temperatures: °F ↔ °C (each side rounded for display).
    const [snowIn, hiF, loF] = [...nums(before.day.match(/snow ([\d.]+)″/)![1]), ...nums(before.day.match(/high \/ low (.+)$/)![1])]
    expect(after.day).toMatch(/snow [\d.]+ cm; high \/ low [−-]?\d+° \/ [−-]?\d+°/)
    const [snowCm, hiC, loC] = [...nums(after.day.match(/snow ([\d.]+) cm/)![1]), ...nums(after.day.match(/high \/ low (.+)$/)![1])]
    expect(Math.abs(snowIn * 2.54 - snowCm), `${before.day} vs ${after.day}`).toBeLessThanOrEqual(0.2)
    expect(Math.abs(hiF - (hiC * 9) / 5 - 32), `${before.day} vs ${after.day}`).toBeLessThanOrEqual(1.5)
    expect(Math.abs(loF - (loC * 9) / 5 - 32), `${before.day} vs ${after.day}`).toBeLessThanOrEqual(1.5)

    // Distance and elevation.
    expect(after.drive).toMatch(/ km$/)
    expect(Math.abs(nums(before.drive)[0] * 1.609344 - nums(after.drive)[0])).toBeLessThanOrEqual(1.5)
    expect(after.elevation).toMatch(/ m → .* m$/)
    const [baseFt, topFt] = nums(before.elevation)
    const [baseM, topM] = nums(after.elevation)
    expect(Math.abs(baseFt * 0.3048 - baseM)).toBeLessThanOrEqual(1)
    expect(Math.abs(topFt * 0.3048 - topM)).toBeLessThanOrEqual(1)

    // Money: converted with the stored rate, labelled as CAD.
    expect(after.perDay).toMatch(/^CA\$/)
    expect(Math.abs(nums(before.perDay)[0] * cadRate - nums(after.perDay)[0]), `${before.perDay} → ${after.perDay} at ${cadRate}`).toBeLessThanOrEqual(0.02)
    expect(after.budget).toMatch(/CA\$/)
    const [lowUsd, highUsd] = nums(before.budget)
    const [lowCad, highCad] = nums(after.budget)
    expect(Math.abs(lowUsd * cadRate - lowCad)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(highUsd * cadRate - highCad)).toBeLessThanOrEqual(1.5)

    // Comparisons are untouched: the same pick with the same ranking total.
    expect(after.pick).toBe(before.pick)
    expect(after.total).toBe(before.total)
  } finally {
    await choose(page, IMPERIAL_USD)
  }

  // Back to °F / in / mi / ft / USD: every value is exactly what it was.
  expect(await readDisplayed(page)).toEqual(before)
})
