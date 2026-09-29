/**
 * Journey 4 — Select an exact pass product and dates and see the access restrictions that apply, without ever
 * treating an unknown rule as permission. Demo mode (Fri 15 Jan 2027), where an Indy Base Pass is owned with two
 * logged days.
 */
import { expect, test } from './fixtures'
import { definition } from './helpers'

test.use({ mode: 'demo' })

test('the pass checker answers from exact product rules and never counts unknown as access @mobile', async ({ page }) => {
  await page.goto('/passes')
  await expect(page.getByRole('heading', { level: 1, name: 'Passes & Costs' })).toBeVisible()

  // The owned pass shows its remaining days per resort (two logged at Greek Peak).
  const owned = page.getByRole('region', { name: 'Your passes' }).getByRole('article', { name: 'Indy Base Pass' })
  await expect(owned).toBeVisible()
  const remaining = owned.getByRole('list', { name: 'Remaining days by resort' })
  await expect(remaining.getByRole('listitem').filter({ hasText: 'Greek Peak' })).toContainText('No days left')
  await expect(remaining.getByRole('listitem').filter({ hasText: 'Swain' })).toContainText('2 days left')
  await expect(owned.getByRole('img', { name: '2 of 2 days used, 0 left' })).toBeVisible()

  const checker = page.getByRole('region', { name: /Can I use my exact pass here/ })
  const pass = checker.getByRole('combobox', { name: 'Pass' })
  const resort = checker.getByRole('combobox', { name: 'Resort' })

  // 1. An exact product (Ikon Pass, not the Ikon family) — where does it work this weekend?
  await pass.selectOption({ label: 'Ikon Pass' })
  await expect(page).toHaveURL(/[?&]pass=ikon-pass-2026-27/)
  await checker.getByRole('group', { name: 'Date shortcuts' }).getByRole('button', { name: /Sat–Sun|This weekend/ }).click()
  await expect(page).toHaveURL(/from=2027-01-16&to=2027-01-17/)
  const unconfirmed = checker.getByRole('region', { name: /Not confirmed/ })
  await expect(unconfirmed.getByRole('link', { name: /^Alta Ski Area/ })).toContainText(/Not confirmed/)
  await expect(checker.getByRole('region', { name: /^Can use/ })).toHaveCount(0)
  await expect(checker).toContainText(/not confirmed, never assumed included/)

  // 2. Ikon Pass at Alta: a rule is on file but its access is unknown → every day "not confirmed", never included.
  await resort.selectOption({ label: 'Alta Ski Area' })
  await expect(page).toHaveURL(/[?&]resort=alta/)
  await expect(checker).toContainText(/0\/2\s*days confirmed — access not confirmed/)
  const days = checker.getByRole('list', { name: 'Day by day' })
  await expect(days.getByRole('listitem')).toHaveCount(2)
  for (const item of await days.getByRole('listitem').all()) await expect(item).toContainText('Not confirmed')
  const rule = checker.getByRole('region', { name: 'The rule behind this answer' })
  await expect(definition(rule, 'Access')).toHaveText(/Unknown — not confirmed/)
  await expect(checker).not.toContainText(/Included|Can use/)
  await expect(rule.getByRole('link', { name: /Enter a new version|Enter the rule/ })).toBeVisible()

  // 3. Ikon Pass at a resort with no rule recorded at all: still "not confirmed", with the reason said plainly.
  await resort.selectOption({ label: 'Greek Peak Mountain Resort' })
  await expect(page).toHaveURL(/[?&]resort=greek-peak/)
  await expect(rule).toContainText(/No rule is recorded for Ikon Pass at Greek Peak Mountain Resort/)
  await expect(rule).toContainText(/never treats a missing rule as access/)
  await expect(checker).not.toContainText(/Included/)

  // 4. The pass I own at Greek Peak on Saturday: limited days, all used — the restriction applies.
  await pass.selectOption({ label: 'Indy Base Pass (yours)' })
  await expect(page).toHaveURL(/[?&]own=/)
  await checker.getByRole('button', { name: 'Single day' }).click()
  await expect(page).not.toHaveURL(/[?&]to=/)
  await expect(checker.getByRole('textbox', { name: 'From' })).toHaveValue('2027-01-16')
  await expect(checker).toContainText(/No days left/)
  await expect(checker.getByRole('img', { name: /2 of 2 days used, 0 left/ })).toBeVisible()
  await expect(definition(rule, 'Access')).toHaveText('Limited days')
  await expect(definition(rule, 'Days')).toContainText('2 days at Greek Peak')
  await expect(definition(rule, 'Blackouts')).toBeVisible()
  await expect(definition(rule, 'Reservations')).toBeVisible()

  // 5. The same pass at Swain, where its two days are still unused: included, with the days left.
  await resort.selectOption({ label: 'Swain Resort' })
  await expect(page).toHaveURL(/[?&]resort=swain/)
  await expect(checker).toContainText(/Included — 2 days left/)
})
