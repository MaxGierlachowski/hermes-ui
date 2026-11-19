import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockApi } from './mock'

// A long word without spaces (a URL with query parameters) must wrap inside the composer instead of
// widening it: the composer, the title field and the dialog stay within the dialog / panel width.
// Runs on the phones and on the desktop (see playwright.config.ts).

const LONG_URL = `https://tickets.example.com/?ci=1&cm=${'2345089939_8194436094751_m_g_campaign%20vienna%20at_e__kwd-'.repeat(4)}&gad_source=1&gbraid=0AAAAACRC4b3zni2IW5aahumpwza4RxSBR`

async function box(l: Locator) {
  const b = await l.boundingBox()
  expect(b).not.toBeNull()
  return b!
}

async function noHorizontalOverflow(page: Page, container: Locator) {
  const c = await box(container)
  for (const l of [page.locator('[data-slot=textarea]').last(), container.locator('[data-slot=input]')]) {
    if (!(await l.count())) continue
    const b = await box(l.first())
    expect(b.x).toBeGreaterThanOrEqual(c.x - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 1)
  }
  // Nothing inside scrolls sideways either.
  expect(await container.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
}

test('a long URL in the new-chat dialog wraps inside the dialog', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/board')
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await page.getByRole('button', { name: 'Neuer Chat' }).first().click()
  const dialog = page.locator('[data-slot=dialog-content]')
  await expect(dialog).toBeVisible()
  // Measure after the open animation (zoom-in-95), not in the middle of it.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  const before = await box(dialog)
  await dialog.locator('[data-slot=textarea]').fill(`Neuer Task: ${LONG_URL}`)
  await noHorizontalOverflow(page, dialog)
  // The dialog keeps its width; the text grows downwards.
  expect(Math.round((await box(dialog)).width)).toBe(Math.round(before.width))
})

test('a long URL in the thread composer wraps inside the panel', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/board/s-approval')
  const textarea = page.locator('[data-slot=textarea]').last()
  await textarea.waitFor()
  const composer = page.locator('[data-slot=prompt-input]').last()
  const before = await box(composer)
  await textarea.fill(LONG_URL)
  const after = await box(composer)
  // Same width as before typing, and the text area stays inside it.
  expect(Math.round(after.width)).toBe(Math.round(before.width))
  const t = await box(textarea)
  expect(t.x + t.width).toBeLessThanOrEqual(after.x + after.width + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})
