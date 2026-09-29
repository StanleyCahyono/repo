/**
 * Journey 6 — Build a trip with a nearby-origin-airport alternative (SYR instead of ITH), a hotel option, an event
 * and an itemised budget, then reload and check that everything persisted. Live mode: the user's own data.
 */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { createTrip, literal, reveal, submitAndWait } from './helpers'

/** Tick "Add a price" in an item editor and enter an estimate. */
async function price(sheet: Locator, amount: string, who: 'Per person' | 'Shared') {
  await sheet.getByRole('checkbox', { name: /^Add a price/ }).check()
  await sheet.getByRole('textbox', { name: 'Amount' }).fill(amount)
  await expect(sheet.getByRole('combobox', { name: 'Currency' })).toHaveValue('USD')
  await sheet.getByRole('radiogroup', { name: 'Who pays' }).getByRole('radio', { name: new RegExp(`^${who}`) }).click()
}

async function save(page: Page, sheet: Locator, button: 'Add to trip' | 'Save') {
  await submitAndWait(page, sheet.getByRole('button', { name: button, exact: true }))
  await expect(sheet).toBeHidden()
}

test('a trip from SYR with a hotel option, an event and an itemised budget survives a reload @mobile', async ({ page }, testInfo) => {
  const name = `E2E Alta weekend (${testInfo.project.name})`
  const trip = await createTrip(page, { name, resort: 'Alta Ski Area', weekend: 1 })
  await expect(page.getByRole('main')).toContainText('Draft')

  // Nearby origin airport: fly from Syracuse instead of the default Ithaca.
  const origins = page.getByRole('region', { name: 'Origin airports' })
  await expect(origins.getByRole('radio', { name: 'ITH selected as origin' })).toBeChecked()
  await submitAndWait(page, origins.getByRole('radio', { name: 'Use SYR as origin' }))
  await expect(origins.getByRole('radio', { name: 'SYR selected as origin' })).toBeChecked()
  await expect(page.getByRole('region', { name: 'Fly SYR → SLC' })).toBeVisible()

  // The flight from SYR, priced per person (your estimate — never a fetched fare).
  await page.getByRole('region', { name: 'Flights' }).getByRole('button', { name: 'Enter a flight' }).click()
  let sheet = page.getByRole('dialog', { name: 'Add flight' })
  await expect(sheet.getByRole('combobox', { name: 'From (airport)' })).toHaveValue('SYR')
  await expect(sheet.getByRole('combobox', { name: 'To (airport)' })).toHaveValue('SLC')
  await sheet.getByRole('textbox', { name: 'Title' }).fill('Flights SYR ⇄ SLC')
  await price(sheet, '420', 'Per person')
  await save(page, sheet, 'Add to trip')
  await expect(page.getByRole('region', { name: 'Flights' }).getByRole('button', { name: 'Flights SYR ⇄ SLC', exact: true })).toBeVisible()

  // A hotel option from the curated list, then priced for the stay.
  const stay = page.getByRole('region', { name: 'Stay' })
  const option = (await reveal(stay.getByRole('region', { name: 'Options on file', includeHidden: true }))).getByRole('listitem').filter({ hasText: /^Alta Lodge/ })
  await submitAndWait(page, option.getByRole('button', { name: 'Save as option' }))
  const hotel = stay.getByRole('button', { name: 'Alta Lodge', exact: true })
  await expect(hotel).toBeVisible()
  await expect(stay.getByRole('button', { name: /Status: Idea\. Change status of Alta Lodge/ })).toBeVisible()
  await hotel.click()
  sheet = page.getByRole('dialog', { name: 'Edit lodging' })
  await expect(sheet).toBeVisible()
  await price(sheet, '900', 'Shared')
  await save(page, sheet, 'Save')

  // An event on the second day.
  const events = page.getByRole('region', { name: 'Events' })
  await events.getByRole('button', { name: 'Your own event' }).click()
  sheet = page.getByRole('dialog', { name: 'Add event' })
  await sheet.getByRole('textbox', { name: 'Title' }).fill('Après ski-club social')
  await sheet.getByRole('textbox', { name: /^Date/ }).fill(trip.end)
  await sheet.getByRole('textbox', { name: /^Venue/ }).fill('Goldminer’s Daughter')
  await price(sheet, '35', 'Per person')
  await save(page, sheet, 'Add to trip')
  await expect(events.getByRole('button', { name: 'Après ski-club social', exact: true })).toBeVisible()

  // The itemised budget: each priced line, and a total that says it is incomplete (ski days are unpriced).
  const expectBudget = async () => {
    // A table on wide screens, a list on phones: one line per item either way.
    const itemised = await reveal(page.getByRole('region', { name: 'Itemised', includeHidden: true }))
    const line = (title: RegExp) => itemised.getByRole('row', { name: title }).or(itemised.getByRole('listitem').filter({ hasText: title }))
    await expect(line(/^Flights SYR ⇄ SLC/)).toContainText('$420')
    await expect(line(/^Alta Lodge/)).toContainText('$900')
    await expect(line(/^Après ski-club social/)).toContainText('$35')
    await expect(line(/^Known so far/)).toContainText('$1,355')
    await expect(page.getByRole('region', { name: 'Budget' })).toContainText(/Known so far \$1,355/)
  }
  await expectBudget()

  // Reload: origin, flight, hotel, event and budget are all stored.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(page.getByRole('region', { name: 'Origin airports' }).getByRole('radio', { name: 'SYR selected as origin' })).toBeChecked()
  await expect(page.getByRole('region', { name: 'Flights' }).getByRole('button', { name: 'Flights SYR ⇄ SLC', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Stay' }).getByRole('button', { name: 'Alta Lodge', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Events' }).getByRole('button', { name: 'Après ski-club social', exact: true })).toBeVisible()
  await expectBudget()
  // The trip list carries it too, flying from SYR.
  await page.goto('/trips')
  await expect(page.getByRole('link', { name: literal(name) }).first()).toBeVisible()
  await expect(page.getByRole('main')).toContainText(/from SYR/)
  expect(trip.id).toMatch(/^e2e-alta-weekend/)
})
