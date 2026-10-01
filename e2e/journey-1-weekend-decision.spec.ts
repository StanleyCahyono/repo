/**
 * Journey 1 — From Today, choose a weekend, compare practical resorts, inspect the ranking explanation, and save a
 * trip. Demo mode: an in-season recommendation on the simulated Fri 15 Jan 2027.
 */
import { expect, test } from './fixtures'
import { literal, submitAndWait, toast, visible } from './helpers'

test.use({ mode: 'demo' })

test('choose a weekend on Today, inspect why the pick wins, compare it and save a trip @mobile', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()

  // Choose the weekend (Sat 16 – Sun 17 Jan): the choice lives in the URL and the ranking follows it.
  await page.getByRole('radiogroup', { name: 'Dates to rank' }).getByRole('radio', { name: /weekend/i }).click()
  await expect(page).toHaveURL(/[?&]from=2027-01-16&to=2027-01-17/)
  const where = page.getByRole('region', { name: /^Where to ski/ })
  await expect(where.getByRole('heading', { level: 2 })).toContainText('Sat 16 – Sun 17 Jan')
  await expect(page.getByRole('radiogroup', { name: 'Dates to rank' }).getByRole('radio', { name: /weekend/i })).toHaveAttribute('aria-checked', 'true')
  // "Learning day" (the chip's visible label; its accessible name adds the weights).
  const preset = (await page.getByRole('radiogroup', { name: 'Rank for' }).getByRole('radio', { checked: true }).innerText()).split(/\n|,/)[0].trim()
  expect(preset).not.toBe('')

  // The pick and its explanation: benefits, trade-offs, evidence limits and the factor table that adds up.
  const pickHeading = where.getByRole('heading', { level: 3, name: /^Top pick:/ })
  await expect(pickHeading).toBeVisible()
  const winner = (await pickHeading.getByRole('link').innerText()).trim()
  const winnerId = resortId(await pickHeading.getByRole('link').getAttribute('href'))
  const why = where.getByRole('heading', { name: /Why it ranks first/ })
  await expect(why).toBeVisible()
  await expect(why.locator('xpath=following::li[1]')).toBeVisible()
  await expect(where.getByRole('heading', { name: /Trade-offs/ })).toBeVisible()
  await expect(where.getByRole('heading', { name: /Evidence limits/ })).toBeVisible()
  await expect(where).toContainText(/Best day (Sat 16|Sun 17) Jan/)
  const factors = where.getByRole('table', { name: literal(`(${preset})`) })
  await expect(factors).toBeVisible()
  await expect(factors.getByRole('row', { name: /Ranking total/ })).toContainText(/\d+\.\d/)
  await expect(where).toContainText(/Scores describe suitability, not safety/)

  // The runner-up says why it sits below the pick.
  const second = where.getByRole('listitem').filter({ hasText: /2nd:/ })
  await expect(second).toBeVisible()
  const runnerUp = (await second.getByRole('link').first().innerText()).trim()
  const runnerUpId = resortId(await second.getByRole('link').first().getAttribute('href'))
  await expect(second).toContainText(/behind/)

  // Save the pick as a draft trip for the weekend (nothing is booked).
  await submitAndWait(page, where.getByRole('button', { name: 'Save as draft trip' }))
  const saved = toast(page, /Draft trip saved/).getByText(/^Draft trip saved: /)
  await expect(saved).toBeVisible()
  const tripName = (await saved.innerText()).replace(/^Draft trip saved: /, '').trim()
  expect(tripName, 'the toast names the saved trip').not.toBe('')
  const opened = where.getByRole('link', { name: /Saved — open trip/ })
  await expect(opened).toBeVisible()
  const tripHref = await opened.getAttribute('href')
  expect(tripHref).toMatch(/^\/trips\/[a-z0-9-]+$/)

  // Compare the pick with the runner-up on identical terms: its resort page keeps the best day, and "Compare" opens
  // the side-by-side view with that same date and scoring mode in every column.
  await where.getByRole('link', { name: /^Resort page/ }).click()
  await expect(page).toHaveURL(/\/resorts\/[a-z0-9-]+\?date=2027-01-1[67]/)
  const date = new URL(page.url()).searchParams.get('date')!
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(winner)
  await visible(page.getByRole('button', { name: /^Compare\b/ })).click()
  const sheet = page.getByRole('dialog', { name: /^Compare .+ with/ })
  await expect(sheet).toBeVisible()
  // The picker lists short names ("Bristol Mountain" for "Bristol Mountain Winter Resort"): search, then tick it.
  const word = runnerUp.split(' ')[0]
  await sheet.getByRole('textbox', { name: 'Find a resort' }).fill(word)
  const pickRunnerUp = sheet.getByRole('checkbox', { name: new RegExp(`^${word}\\b`) }).first()
  if (!(await pickRunnerUp.isChecked())) await pickRunnerUp.check()
  await expect(pickRunnerUp).toBeChecked()
  await sheet.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page).toHaveURL(/\/explore\/compare\?/)
  const url = new URL(page.url())
  expect(url.searchParams.get('date')).toBe(date)
  expect(url.searchParams.get('ids')?.split(',')).toEqual(expect.arrayContaining([winnerId, runnerUpId]))

  const dayLabel = date.endsWith('16') ? 'Sat 16 Jan' : 'Sun 17 Jan'
  const scenario = page.getByRole('region', { name: 'Same scenario for every column' })
  await expect(scenario).toBeVisible()
  // Phones summarise the scenario behind "Change"; open it through that control.
  const change = scenario.getByRole('button', { name: 'Change' })
  if (await change.isVisible()) {
    await expect(scenario).toContainText(`${dayLabel} · ${preset}`)
    await change.click()
  }
  await expect(scenario.getByRole('textbox', { name: 'Day' })).toHaveValue(date)
  await expect(scenario.getByRole('combobox', { name: 'Score for' }).locator('option:checked')).toHaveText(preset)
  // Wide screens: one table, a column per resort. Phones: one tab per resort.
  const table = page.getByRole('table', { name: /^Comparison of/ })
  const tabs = page.getByRole('tablist', { name: /Resorts in this comparison/ })
  await expect(table.or(tabs)).toBeVisible()
  if (await table.isVisible()) {
    const caption = (await table.locator('caption').innerText()).trim()
    expect(caption).toContain(winner)
    expect(caption).toContain(runnerUp)
    expect(caption).toContain(preset)
    expect(caption).toContain(`${dayLabel} 2027`)
    await expect(table.getByRole('columnheader', { name: literal(winner) })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: literal(runnerUp) })).toBeVisible()
  } else {
    await expect(tabs.getByRole('tab', { name: new RegExp(`^${word}\\b`) })).toBeVisible()
    for (const name of [winner, runnerUp]) {
      await expect(page.getByRole('tabpanel', { name })).toContainText(`Conditions · ${dayLabel}`)
    }
  }

  // The saved trip is on /trips, survives a reload and opens with the pick and the weekend.
  await page.goto('/trips')
  const listed = page.getByRole('link', { name: literal(tripName) }).and(page.locator(`[href="${tripHref}"]`)).first()
  await expect(listed).toBeVisible()
  await page.reload()
  await expect(listed).toBeVisible()
  await listed.click()
  await expect(page).toHaveURL(new RegExp(`${tripHref}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tripName)
  await expect(page.getByRole('main')).toContainText(winner)
  await expect(page.getByRole('main')).toContainText(/16–17 Jan 2027|Sat 16 Jan|Sun 17 Jan/)
  await expect(page.getByRole('main')).toContainText('Draft')
})

/** "/resorts/greek-peak?date=…" → "greek-peak". */
function resortId(href: string | null): string {
  const id = href?.match(/\/resorts\/([a-z0-9-]+)/)?.[1]
  expect(id, `resort link ${href}`).toBeTruthy()
  return id!
}
