// The PDF preview draws real pages (pdf.js on a canvas) in WebKit and Chromium. Before, it was the
// browser's own viewer in an iframe, which stayed white in the desktop app (WKWebView): pixels, not
// screenshots of a frame, are what is checked here.
import { expect, test, type Page } from '@playwright/test'

async function openPdf(page: Page) {
  await page.goto('/demo?thread=demo-files')
  await page.getByText('q3-report.pdf').first().click()
  await expect(page.getByTestId('pdf-pages')).toBeVisible()
}

/** Pixels of a page's canvas: size, and how many are dark (text) or not white at all. */
const ink = (page: Page, n: number) => page.locator(`[data-page="${n}"] canvas`).evaluate((c: HTMLCanvasElement) => {
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  let dark = 0, white = 0
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3
    if (data[i + 3] > 0 && l < 128) dark++
    if (data[i + 3] === 255 && l > 250) white++
  }
  return { width: c.width, height: c.height, cssWidth: c.clientWidth, dark, white, pixels: c.width * c.height }
})

test('the PDF preview renders its pages on a canvas', async ({ page }) => {
  await openPdf(page)
  await expect(page.locator('[data-page]')).toHaveCount(3)
  await expect.poll(async () => (await ink(page, 1)).dark, { timeout: 15_000 }).toBeGreaterThan(500)
  const p1 = await ink(page, 1)
  expect(p1.width).toBeGreaterThan(0)
  expect(p1.height).toBeGreaterThan(p1.width) // portrait letter page
  expect(p1.width).toBe(Math.floor(p1.cssWidth * 2)) // sharp at deviceScaleFactor 2
  expect(p1.white / p1.pixels).toBeGreaterThan(0.8) // white paper with text on it, not a dark or blank box
  await expect(page.getByText('1 / 3')).toBeVisible()
})

test('scrolling renders the next pages and moves the page counter', async ({ page }) => {
  await openPdf(page)
  await page.locator('[data-page="3"]').scrollIntoViewIfNeeded()
  await expect.poll(async () => (await ink(page, 3)).dark, { timeout: 15_000 }).toBeGreaterThan(200)
  await expect(page.getByText('3 / 3')).toBeVisible()
})

test('the pages stay white paper in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openPdf(page)
  await expect.poll(async () => (await ink(page, 1)).dark, { timeout: 15_000 }).toBeGreaterThan(500)
  expect((await ink(page, 1)).white / (await ink(page, 1)).pixels).toBeGreaterThan(0.8)
})
