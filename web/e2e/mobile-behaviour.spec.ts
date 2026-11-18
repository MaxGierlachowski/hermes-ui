import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './mock'

// Touch gestures and keyboard handling on phones, driven with real touch events (CDP), not mouse events.

async function touch(page: Page, points: [number, number][], holdMs = 0) {
  const cdp = await page.context().newCDPSession(page)
  const at = ([x, y]: [number, number]) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(points[0]) })
  if (holdMs) await page.waitForTimeout(holdMs)
  for (const p of points.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(p) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

const line = (from: [number, number], to: [number, number], steps = 8) =>
  Array.from({ length: steps + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps] as [number, number])

async function openBoard(page: Page, hash = '#/board') {
  await mockApi(page)
  await page.goto(`/${hash}`)
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
}

test('swiping the thread sheet down closes it', async ({ page }) => {
  await openBoard(page, '#/board/s-approval')
  const sheet = page.locator('[data-slot=sheet-content]')
  await expect(sheet).toBeVisible()
  const grip = await sheet.locator('[data-sheet-drag]').first().boundingBox()
  const x = grip!.x + grip!.width / 2
  const y = grip!.y + grip!.height / 2
  await touch(page, line([x, y], [x, y + 220]))
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/#\/board$/)
})

test('a short drag springs back instead of closing', async ({ page }) => {
  await openBoard(page, '#/board/s-approval')
  const sheet = page.locator('[data-slot=sheet-content]')
  const grip = await sheet.locator('[data-sheet-drag]').first().boundingBox()
  const x = grip!.x + grip!.width / 2
  const y = grip!.y + grip!.height / 2
  await touch(page, line([x, y], [x, y + 40], 10))
  await page.waitForTimeout(300)
  await expect(sheet).toBeVisible()
})

test('long-pressing a card offers "move to column"', async ({ page }) => {
  await openBoard(page)
  const moves: unknown[] = []
  page.on('request', (r) => { if (r.url().endsWith('/api/sessions/s-approval/column')) moves.push(r.postDataJSON()) })
  const card = await page.getByText('Landingpage-Build reparieren und deployen').first().boundingBox()
  await touch(page, [[card!.x + 20, card!.y + 8]], 650)
  await expect(page.getByText('Verschieben nach')).toBeVisible()
  await page.getByRole('radio', { name: 'Done' }).tap()
  await expect.poll(() => moves).toEqual([{ column: 'done' }])
  // The long press must not also open the thread.
  await expect(page).toHaveURL(/#\/board$/)
})

test('swiping the card list sideways switches the column', async ({ page }) => {
  await openBoard(page)
  await expect(page.getByRole('tab', { name: /^Waiting/ })).toHaveAttribute('aria-selected', 'true')
  const list = await page.getByRole('tabpanel').boundingBox()
  const y = list!.y + 60
  await touch(page, line([list!.x + list!.width - 30, y], [list!.x + 40, y + 10]))
  await expect(page.getByRole('tab', { name: /^Done/ })).toHaveAttribute('aria-selected', 'true')
})

test('composer: Enter is a new line on touch, the round button sends', async ({ page }) => {
  await openBoard(page, '#/board/s-waiting')
  const sent: unknown[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/sessions/s-waiting/messages')) sent.push(r.postDataJSON()) })
  const field = page.getByPlaceholder('Antworten …')
  await expect(page.getByTestId('mic')).toBeVisible()
  await field.tap()
  await field.pressSequentially('Erste Zeile')
  await field.press('Enter')
  await field.pressSequentially('zweite Zeile')
  expect(sent).toEqual([])
  await expect(field).toHaveValue('Erste Zeile\nzweite Zeile')
  await page.getByTestId('send').tap()
  await expect.poll(() => sent.length).toBe(1)
  expect((sent[0] as { text: string }).text).toBe('Erste Zeile\nzweite Zeile')
})

test('the thread sheet stays above an on-screen keyboard (iOS visualViewport)', async ({ page }) => {
  await openBoard(page, '#/board/s-waiting')
  const sheet = page.locator('[data-slot=sheet-content]')
  const vh = page.viewportSize()!.height
  // iOS: the keyboard shrinks only the visual viewport; the layout viewport keeps its height.
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 336 })
    vv.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset'))).toBe('336px')
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height)).toBe(vh - 336)
  const field = await page.getByPlaceholder('Antworten …').boundingBox()
  expect(field!.y + field!.height).toBeLessThanOrEqual(vh - 336)
  expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(0)
})

test('"Neuer Chat" opens as a bottom sheet and moves above the keyboard', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Neuer Chat' }).last().tap()
  const dialog = page.getByRole('dialog')
  const vh = page.viewportSize()!.height
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height)).toBe(vh)
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 336 })
    vv.dispatchEvent(new Event('resize'))
  })
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height)).toBe(vh - 336)
  expect((await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(0)
})

test('unsent text survives closing the thread by accident', async ({ page }) => {
  await openBoard(page, '#/board/s-waiting')
  await page.getByPlaceholder('Antworten …').fill('Halb fertiger Gedanke')
  const grip = await page.locator('[data-slot=sheet-content] [data-sheet-drag]').first().boundingBox()
  const x = grip!.x + grip!.width / 2
  const y = grip!.y + grip!.height / 2
  await touch(page, line([x, y], [x, y + 220]))
  await expect(page.locator('[data-slot=sheet-content]')).toBeHidden()
  await page.getByText('Wochenbericht für das Team zusammenfassen').first().tap()
  await expect(page.getByPlaceholder('Antworten …')).toHaveValue('Halb fertiger Gedanke')
})
