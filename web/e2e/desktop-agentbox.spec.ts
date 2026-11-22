// Agentbox integration in the browser: base path (HERMES_UI_BASE_PATH), proxy mode, ?compose= and the
// PWA's `base` pairing parameter. The built UI is served by `vite preview` at /, so the base path is
// simulated: the page is loaded from /hermes/ with the page config the backend would inject, and every
// /hermes/… request is answered from / (like Caddy's handle_path).
import { expect, test, type Page } from '@playwright/test'
import { mockApi } from './mock'

const PAGE_CONFIG = { base: '/hermes', auth: 'proxy', pairingUrl: '/devices?pair=1' }

async function underPrefix(page: Page, apiCalls: string[]) {
  await mockApi(page)
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/api/')) apiCalls.push(u.pathname) })
  await page.route(/\/hermes\/(?!api\/)/, async (route) => {
    const url = new URL(route.request().url())
    const res = await route.fetch({ url: url.href.replace('/hermes/', '/') })
    if (!/text\/html/.test(res.headers()['content-type'] || '')) return route.fulfill({ response: res })
    // What src/page.mjs does on the server.
    const meta = JSON.stringify(PAGE_CONFIG).replace(/"/g, '&quot;')
    const html = (await res.text()).replace('<head>', `<head>\n<base href="/hermes/">\n<meta name="hermes-ui-config" content="${meta}">`)
    return route.fulfill({ response: res, body: html })
  })
  // The real proxy mode: the remote state says so.
  await page.route('**/hermes/api/remote', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ local: false, remote: { mode: 'off', status: 'off', url: null, error: null, auth: 'proxy', pairingUrl: '/devices?pair=1' }, devices: [] }),
  }))
}

test('under /hermes/ every asset, API call and the event stream stay below the prefix', async ({ page }) => {
  const apiCalls: string[] = []
  const assets: string[] = []
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === 'http://127.0.0.1:4179' && !u.pathname.includes('/api/')) assets.push(u.pathname) })
  await underPrefix(page, apiCalls)
  await page.goto('/hermes/#/board')
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await expect.poll(() => apiCalls.some((p) => p === '/hermes/api/events')).toBe(true)
  expect(apiCalls.length).toBeGreaterThan(2)
  expect(apiCalls.filter((p) => !p.startsWith('/hermes/api/'))).toEqual([])
  expect(assets.filter((p) => !p.startsWith('/hermes/'))).toEqual([])
  expect(assets.some((p) => /^\/hermes\/assets\/.+\.js$/.test(p))).toBe(true)
  expect(await page.evaluate(() => document.baseURI)).toBe('http://127.0.0.1:4179/hermes/')
  expect(await page.evaluate(() => (document.querySelector('link[rel=manifest]') as HTMLLinkElement).href)).toBe('http://127.0.0.1:4179/hermes/manifest.webmanifest')
})

test('proxy mode: the remote dialog links to the pairing page instead of minting codes', async ({ page }) => {
  const apiCalls: string[] = []
  await underPrefix(page, apiCalls)
  await page.goto('/hermes/#/board')
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await page.getByRole('button', { name: 'Fernzugriff' }).click()
  const link = page.getByTestId('pairing-url')
  await expect(link).toHaveAttribute('href', 'http://127.0.0.1:4179/devices?pair=1')
  await expect(link).toHaveAttribute('target', '_blank')
  expect(apiCalls).not.toContain('/hermes/api/pair')
})

test('?compose= prefills the composer of a new chat and sends nothing', async ({ page }) => {
  const posts: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/sessions')) posts.push(r.url()) })
  await mockApi(page)
  await page.goto(`/?compose=${encodeURIComponent('Summarize the PR\nand list risks')}#/board`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('textarea')).toHaveValue('Summarize the PR\nand list risks')
  expect(new URL(page.url()).search).toBe('')
  expect(new URL(page.url()).hash).toBe('#/board')
  await page.waitForTimeout(300)
  expect(posts).toEqual([])
  // Closing drops the text; it does not come back.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Neuer Chat' }).first().click()
  await expect(page.getByRole('dialog').locator('textarea')).toHaveValue('')
})

test('a pairing link with base= remembers the base path for every later call', async ({ page }) => {
  const id = 'ab'.repeat(32)
  // Keep the iroh client offline: this test is about the fragment, not the connection.
  await page.route('**/*.wasm', (route) => route.abort())
  await page.goto(`/#iroh=${id}&pair=code123&base=%2Fhermes%2F&relay=https%3A%2F%2Frelay.example`)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hk_remote'))).not.toBeNull()
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('hk_remote')))!)
  expect(saved).toEqual({ endpointId: id, relayUrl: 'https://relay.example', base: '/hermes' })
  expect(new URL(page.url()).hash).toBe('')
})
