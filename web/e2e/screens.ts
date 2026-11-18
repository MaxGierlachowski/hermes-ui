// Every screen of the app as a reproducible state: used by the touch-target check and the screenshot run.
import type { Page } from '@playwright/test'
import { mockApi } from './mock'

export type Screen = { name: string; mobileOnly?: boolean; setup: (page: Page, mobile: boolean) => Promise<void> }

const settle = (page: Page) => page.waitForTimeout(350)

async function open(page: Page, hash = '#/board', auth = true) {
  await mockApi(page, { auth })
  await page.goto(`/${hash}`)
  if (auth) await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await settle(page)
}

async function openThread(page: Page, id = 's-approval') {
  await open(page, `#/board/${id}`)
  await page.locator('textarea').last().waitFor()
  await settle(page)
}

export const SCREENS: Screen[] = [
  { name: 'board', setup: (page) => open(page) },
  {
    name: 'board-doing', mobileOnly: true,
    setup: async (page) => { await open(page); await page.getByRole('tab', { name: /^Doing/ }).or(page.getByRole('button', { name: /^Doing/ })).first().click(); await settle(page) },
  },
  {
    name: 'thread',
    setup: async (page) => { await openThread(page); await page.getByText('Freigabe nötig').scrollIntoViewIfNeeded(); await settle(page) },
  },
  {
    name: 'thread-top',
    setup: async (page) => {
      await openThread(page)
      await page.locator('#msg-1').scrollIntoViewIfNeeded()
      await settle(page)
    },
  },
  {
    name: 'composer-attachments',
    setup: async (page) => {
      await openThread(page, 's-waiting')
      await page.locator('input[type=file]').setInputFiles({ name: 'shot.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#6366f1"/></svg>') })
      await page.getByPlaceholder(/Antworten/).fill('Hier noch ein zweiter Screenshot.\nUnd eine zweite Zeile, damit das Feld wächst.')
      await settle(page)
    },
  },
  {
    name: 'thread-paseo',
    setup: async (page) => { await openThread(page); await page.getByRole('button', { name: /Paseo-Agents/ }).click(); await page.getByText('Fix Astro build').first().waitFor(); await settle(page) },
  },
  {
    name: 'paseo-transcript',
    setup: async (page) => {
      await openThread(page)
      await page.getByTestId('paseo-card').click()
      await page.getByText('Read-only Transkript').waitFor()
      await settle(page)
    },
  },
  {
    name: 'thread-column-select',
    setup: async (page) => {
      await openThread(page)
      // Desktop: dropdown (combobox → option); phones: button → bottom sheet (radio).
      await page.getByRole('combobox', { name: 'Spalte' }).or(page.getByRole('button', { name: 'Spalte' })).click()
      await page.getByRole('option', { name: 'Done' }).or(page.getByRole('radio', { name: 'Done' })).waitFor()
      await settle(page)
    },
  },
  {
    name: 'lightbox',
    setup: async (page) => {
      await openThread(page)
      await page.locator('#msg-1').scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'Bild vergrößern' }).first().click()
      await settle(page)
    },
  },
  {
    // Phones: the image viewer after a two-finger pinch (no animation, so it works on the frozen clock).
    name: 'lightbox-zoomed', mobileOnly: true,
    setup: async (page) => {
      await openThread(page)
      await page.locator('#msg-1').scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'Bild vergrößern' }).first().click()
      await page.getByTestId('image-viewer').waitFor()
      await settle(page)
      const { width, height } = page.viewportSize()!
      const cdp = await page.context().newCDPSession(page)
      const pts = (d: number) => [{ x: width / 2 - d, y: height / 2, id: 1 }, { x: width / 2 + d, y: height / 2, id: 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) })
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(30 + 9 * i) })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await settle(page)
    },
  },
  {
    name: 'toast',
    setup: async (page) => { await openThread(page, 's-doing'); await page.getByRole('button', { name: 'Stoppen', exact: true }).click(); await page.getByText('Stopp gesendet').waitFor(); await settle(page) },
  },
  {
    name: 'new-chat',
    setup: async (page, mobile) => {
      await open(page)
      if (mobile) await page.getByRole('button', { name: 'Neuer Chat' }).last().click()
      else await page.keyboard.press('n')
      await page.getByRole('dialog').waitFor()
      await settle(page)
    },
  },
  { name: 'inbox', setup: (page) => open(page, '#/inbox') },
  {
    name: 'search',
    setup: async (page, mobile) => {
      await open(page)
      if (mobile) await page.getByRole('button', { name: 'Suchen' }).click()
      else await page.keyboard.press('Meta+k')
      await page.getByPlaceholder(/suchen/).fill('astro')
      await page.getByText(/Paket fehlt/).first().waitFor()
      await settle(page)
    },
  },
  {
    name: 'notifications',
    setup: async (page) => { await open(page, '#/inbox'); await page.getByRole('button', { name: 'Benachrichtigungen' }).click(); await page.getByRole('dialog').waitFor(); await settle(page) },
  },
  {
    name: 'remote',
    setup: async (page) => { await open(page); await page.getByRole('button', { name: 'Fernzugriff' }).click(); await page.getByRole('dialog').waitFor(); await settle(page) },
  },
  {
    name: 'login',
    setup: async (page) => { await open(page, '', false); await page.getByRole('button', { name: 'Anmelden' }).waitFor(); await settle(page) },
  },
]
