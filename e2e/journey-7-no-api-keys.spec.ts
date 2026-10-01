/**
 * Journey 7 — Load without optional API keys (no DUFFEL_ACCESS_TOKEN, no ORS_API_KEY: playwright.config.ts blanks
 * them) and still complete planning with the supported fallbacks: search links, manual itinerary and quote entry, and
 * curated drive estimates with map directions links. Live mode.
 */
import { expect, test } from './fixtures'
import { createTrip, definition, reveal, submitAndWait } from './helpers'

test('without optional keys, the fallbacks are explicit and a fly-in trip can still be fully planned @mobile', async ({ page }, testInfo) => {
  // Sources & Sync says plainly what is not configured and what to use instead.
  await page.goto('/sources')
  // A table on wide screens, a list on phones.
  const connectors = page.getByRole('region', { name: 'Connectors' })
  const duffel = connectors.getByRole('row', { name: /Duffel flight offers/ }).or(connectors.getByRole('listitem').filter({ hasText: /^Duffel flight offers/ }))
  await expect(duffel).toContainText(/Needs credentials/)
  await expect(duffel).toContainText(/Not configured/)
  await expect(duffel).toContainText(/search links and manual itinerary\/quote entry/)

  // Drives are curated estimates (no routing key), with a map link for a live estimate elsewhere.
  await page.goto('/resorts/greek-peak')
  const drive = await reveal(page.getByRole('region', { name: /^Drive from/, includeHidden: true }))
  await expect(drive).toContainText(/Curated estimate — not live routing/)
  await expect(drive.getByRole('link', { name: /^Directions from/ })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[-\d.%C,]+&destination=[-\d.%C,]+/)

  // A fly-in trip.
  const name = `E2E Jackson Hole without keys (${testInfo.project.name})`
  const trip = await createTrip(page, { name, resort: 'Jackson Hole Mountain Resort', weekend: 2 })
  const flights = page.getByRole('region', { name: 'Flights' })
  await expect(flights).toContainText(/Live flight offers: not configured/)
  await expect(flights).toContainText(/DUFFEL_ACCESS_TOKEN/)
  await expect(flights).toContainText(/Nothing here is a live fare/)

  // Search links for the chosen origin, destination and the trip's own dates.
  const origins = page.getByRole('region', { name: 'Origin airports' })
  await expect(origins.getByRole('radio', { name: 'ITH selected as origin' })).toBeChecked()
  const google = origins.getByRole('link', { name: /^Google Flights — search ITH to JAC/ })
  await expect(google).toHaveAttribute('href', new RegExp(`google\\.com/travel/flights\\?q=Flights%20from%20ITH%20to%20JAC%20on%20${trip.start}%20through%20${trip.end}`))
  await expect(google).toHaveAttribute('target', '_blank')
  await expect(origins.getByRole('link', { name: /^KAYAK — search ITH to JAC/ })).toHaveAttribute('href', `https://www.kayak.com/flights/ITH-JAC/${trip.start}/${trip.end}`)

  // Manual entry: the itinerary as booked and the quote you were given (with its expiry).
  await flights.getByRole('button', { name: 'Enter a flight' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add flight' })
  await expect(sheet.getByRole('combobox', { name: 'From (airport)' })).toHaveValue('ITH')
  await expect(sheet.getByRole('combobox', { name: 'To (airport)' })).toHaveValue('JAC')
  await sheet.getByRole('textbox', { name: 'Title' }).fill('Quoted flights ITH ⇄ JAC')
  await sheet.getByRole('button', { name: 'Add a segment' }).click()
  await sheet.getByRole('textbox', { name: 'Airline (segment 1)' }).fill('ZZ')
  await sheet.getByRole('textbox', { name: 'Flight no. (segment 1)' }).fill('101')
  await expect(sheet.getByRole('combobox', { name: 'From airport (segment 1)' })).toHaveValue('ITH')
  await sheet.getByRole('combobox', { name: 'To airport (segment 1)' }).fill('JAC')
  await sheet.getByRole('textbox', { name: 'Departs (local) segment 1' }).fill(`${trip.start}T07:00`)
  await sheet.getByRole('textbox', { name: 'Arrives (local) segment 1' }).fill(`${trip.start}T13:30`)
  await sheet.getByRole('checkbox', { name: /^Add a price/ }).check()
  await sheet.getByRole('radiogroup', { name: 'What kind of number' }).getByRole('radio', { name: 'Quote' }).click()
  await sheet.getByRole('textbox', { name: 'Amount' }).fill('612.40')
  await sheet.getByRole('textbox', { name: /^Quote valid until/ }).fill(trip.start)
  await submitAndWait(page, sheet.getByRole('button', { name: 'Add to trip', exact: true }))
  await expect(sheet).toBeHidden()

  const flight = flights.getByRole('article').filter({ has: page.getByRole('button', { name: 'Quoted flights ITH ⇄ JAC', exact: true }) })
  await expect(flight).toContainText('$612.40')
  await expect(flight).toContainText(/Quote/)
  await expect(flight.getByRole('table', { name: /Itinerary you entered/ }).getByRole('row', { name: /ZZ 101 ITH .* JAC/ })).toBeVisible()
  // Airport-local times in two time zones (Eastern → Mountain): 07:00 → 13:30 is 8 h 30 min in the air.
  await expect(definition(flight, 'Journey time')).toHaveText('8 h 30 min')
  await expect(definition(flight, 'Connections')).toHaveText('Nonstop')
  // Door to door is now known: drive to ITH, check-in, the flight, bags, transfer — each labelled by its basis.
  const doorToDoor = page.getByRole('region', { name: 'Fly ITH → JAC' })
  await expect(doorToDoor).toContainText(/door to door/)
  await expect(doorToDoor.getByRole('listitem').filter({ hasText: /Your itinerary/ })).toContainText('8 h 30 min')
  await expect(doorToDoor).not.toContainText(/Unknown until you enter/)

  // Planning is complete enough to budget: the quote is in the itemised budget and the per-person total.
  await expect(page.getByRole('region', { name: 'Budget' })).toContainText(/\$612\.40|\$612/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(page.getByRole('region', { name: 'Flights' }).getByRole('button', { name: 'Quoted flights ITH ⇄ JAC', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Budget' })).toContainText(/\$612/)
  await expect(page.getByRole('region', { name: 'Itinerary' })).toContainText(/Ski day/)
  await expect(page.getByRole('link', { name: /Export \.ics|Export to calendar/ }).first()).toHaveAttribute('href', `/api/export/ics?trip=${trip.id}`)
})
