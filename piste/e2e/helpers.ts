/** Helpers shared by the journeys: disclosures, server actions, keyboard focus, layout and a few multi-step flows. */
import type { Locator, Page, Response } from '@playwright/test'
import { expect } from './fixtures'

/** The demo clock (src/lib/clock.ts): Friday 15 January 2027. */
export const DEMO_TODAY = '2027-01-15'

/** A regexp matching `text` literally. */
export function literal(text: string, flags = ''): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}

/** Parse a displayed number ("1,148", "−3", "-10", "3.1"). */
export function num(text: string): number {
  return Number(text.replace(/[−–]/g, '-').replace(/,/g, ''))
}

/**
 * Make `target` visible by opening every closed <details> around it through its own <summary> (the reviewer may move
 * secondary detail behind disclosures). Anything else must already be reachable.
 */
export async function reveal(target: Locator): Promise<Locator> {
  const el = target.first()
  await el.waitFor({ state: 'attached' })
  for (let i = 0; i < 4 && !(await el.isVisible()); i++) {
    const summary = el.locator('xpath=ancestor::details[not(@open)][last()]/summary')
    if (!(await summary.count())) break
    await summary.first().click()
  }
  await expect(el).toBeVisible()
  return el
}

/** Click something that triggers a server action (or other POST) and wait for its response. */
export async function submitAndWait(page: Page, trigger: Locator | (() => Promise<unknown>)): Promise<Response> {
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).origin === new URL(page.url()).origin)
  await (typeof trigger === 'function' ? trigger() : trigger.click())
  const r = await response
  expect(r.status(), `POST ${r.url()}`).toBeLessThan(400)
  return r
}

/** A toast (role status / alert) with this text. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: text })
}

/** No horizontal page overflow at the current viewport. */
export async function expectNoHorizontalOverflow(page: Page, label = page.url()) {
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  expect(m.scroll, `${label}: page is ${m.scroll}px wide in a ${m.inner}px viewport`).toBeLessThanOrEqual(m.inner)
}

export interface FocusInfo {
  tag: string
  name: string
  href: string | null
  role: string | null
  outlineStyle: string
  outlineWidth: number
  boxShadow: string
  width: number
  height: number
  inViewport: boolean
}

/** What has keyboard focus, with the styles that make focus visible. */
export async function focused(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const labelled = el.getAttribute('aria-labelledby')
    const name =
      el.getAttribute('aria-label') ??
      (labelled ? labelled.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : null) ??
      (el as HTMLInputElement).labels?.[0]?.textContent ??
      el.textContent ??
      ''
    return {
      tag: el.tagName.toLowerCase(),
      name: name.replace(/\s+/g, ' ').trim(),
      href: el.getAttribute('href'),
      role: el.getAttribute('role'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth) || 0,
      boxShadow: cs.boxShadow,
      width: r.width,
      height: r.height,
      inViewport: r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth,
    }
  })
}

/** Press Tab until the focused element satisfies `match` (at most `max` presses); returns it. */
export async function tabUntil(page: Page, match: (f: FocusInfo) => boolean, what: string, max = 60): Promise<FocusInfo> {
  const seen: string[] = []
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const f = await focused(page)
    if (f && match(f)) return f
    seen.push(f ? `${f.tag}${f.role ? `[${f.role}]` : ''} "${f.name.slice(0, 40)}"` : '(body)')
  }
  throw new Error(`Tab never reached ${what} in ${max} presses. Focus went: ${seen.join(' → ')}`)
}

/** Focus is visible: a real outline (the app's :focus-visible ring) or a box-shadow ring, on a rendered element. */
export function expectVisibleFocus(f: FocusInfo, what: string) {
  const ring = (f.outlineStyle !== 'none' && f.outlineWidth >= 1) || (f.boxShadow !== 'none' && f.boxShadow !== '')
  expect(ring, `${what} has no visible focus indicator (outline ${f.outlineStyle} ${f.outlineWidth}px, shadow ${f.boxShadow})`).toBe(true)
  expect(f.width * f.height, `${what} is not rendered`).toBeGreaterThan(4)
  expect(f.inViewport, `${what} is focused off-screen`).toBe(true)
}

/** The visible one of several same-named controls (header vs. mobile action bar, desktop vs. phone layouts). */
export function visible(locator: Locator): Locator {
  return locator.filter({ visible: true }).first()
}

// ---------------------------------------------------------------------------------------------------------------
// Flows

export interface ManualReport {
  sourceUrl: string
  sourceName: string
  /** Last-24-hours snowfall, inches. */
  snow24: string
  /** Base depth, inches. */
  base: string
}

/** Resort page → "Enter an official report" (the manual-edit route) → save. The page must be the resort page. */
export async function enterManualReport(page: Page, report: ManualReport) {
  const open = await reveal(page.getByRole('button', { name: /Enter an official report/ }))
  await open.click()
  const sheet = page.getByRole('dialog', { name: /Enter a report for/ })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('textbox', { name: 'Source link' }).fill(report.sourceUrl)
  await sheet.getByRole('textbox', { name: /Source name/ }).fill(report.sourceName)
  await sheet.getByRole('textbox', { name: '24 hours', exact: true }).fill(report.snow24)
  await sheet.getByRole('textbox', { name: 'Base depth', exact: true }).fill(report.base)
  await submitAndWait(page, sheet.getByRole('button', { name: 'Save report' }))
  await expect(sheet).toBeHidden()
}

export interface NewTrip {
  name: string
  /** Resort to search for and pick (visible name). */
  resort: string
  /** Pick the n-th "Upcoming weekends" chip (0 = the coming weekend) instead of typing dates. */
  weekend?: number
  start?: string
  end?: string
}

/** /trips → New trip → dates, name → resort → Create trip. Resolves on the new trip's page. */
export async function createTrip(page: Page, trip: NewTrip): Promise<{ id: string; start: string; end: string }> {
  await page.goto('/trips')
  await visible(page.getByRole('button', { name: /^(New trip|Plan a trip)$/ })).click()
  const sheet = page.getByRole('dialog', { name: 'New trip' })
  await expect(sheet).toBeVisible()
  const first = sheet.getByRole('textbox', { name: 'First day' })
  const last = sheet.getByRole('textbox', { name: 'Last day' })
  if (trip.start && trip.end) {
    await first.fill(trip.start)
    await last.fill(trip.end)
  } else {
    const chip = sheet.getByRole('group', { name: 'Upcoming weekends' }).getByRole('button').nth(trip.weekend ?? 0)
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
  }
  const start = await first.inputValue()
  const end = await last.inputValue()
  await sheet.getByRole('textbox', { name: /^Name/ }).fill(trip.name)
  await sheet.getByRole('button', { name: /Choose resorts/ }).click()
  await sheet.getByRole('textbox', { name: /Where are you skiing/ }).fill(trip.resort)
  const pick = sheet.getByRole('list', { name: 'Resorts' }).getByRole('button', { name: literal(trip.resort) }).first()
  await pick.click()
  await expect(pick).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: 'Create trip' }).click()
  await page.waitForURL(/\/trips\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: trip.name })).toBeVisible()
  return { id: new URL(page.url()).pathname.split('/').pop()!, start, end }
}

/** The <dd> describing the first <dt> (role term) that matches `term` inside `scope`. */
export function definition(scope: Locator, term: string | RegExp): Locator {
  const t = typeof term === 'string' ? new RegExp(`^\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : term
  return scope.getByRole('term').filter({ hasText: t }).first().locator('xpath=following-sibling::dd[1]')
}
