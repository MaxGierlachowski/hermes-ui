#!/usr/bin/env node
// Interaction check of the universal app's wide (desktop) layout in the demo mode: ⌘K palette, keyboard
// navigation, Esc, text selection, Enter to send, new chat, right-click menu, drag & drop between columns,
// split resize; lightbox, voice message, image paste, camera, refused permissions. Serve app/dist-web on :8811 first (static, index.html fallback).
//   node scripts/check-universal-web.mjs [chromium|webkit]
import { chromium, webkit } from '@playwright/test'
const engine = process.argv[2] || 'chromium'
const browser = await (engine === 'webkit' ? webkit : chromium).launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
const ok = (name, cond) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
const mod = engine === 'webkit' ? 'Meta' : 'Meta'
await page.goto('http://127.0.0.1:8811/demo', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200)
// ⌘K palette
await page.keyboard.press(`${mod}+k`); await page.waitForTimeout(300)
ok('⌘K opens palette', await page.getByPlaceholder(/Search chats|Chats, Inhalte/).isVisible())
await page.keyboard.type('release'); await page.waitForTimeout(600)
await page.keyboard.press('Enter'); await page.waitForTimeout(700)
ok('palette Enter opens thread in split', await page.getByText('Prepare release 1.4').count() >= 2)
// Esc closes thread
await page.locator('body').click({ position: { x: 300, y: 600 } }); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
ok('Esc closes split', await page.getByText('Prepare release 1.4').count() === 1)
// keyboard navigation
await page.keyboard.press(`${mod}+2`); await page.waitForTimeout(200)
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(700)
ok('⌘2 ↓ Enter opens 2nd Doing card', await page.getByText('Check the staging deploy logs').count() >= 2)
await page.screenshot({ path: '/tmp/hu-spike/i-keyboard.png' })
// text selection in a message
const msg = page.locator('.hk-thread').getByText(/staging/).first()
await msg.click({ clickCount: 3 }); await page.waitForTimeout(200)
const sel = await page.evaluate(() => String(getSelection()))
ok(`text selection in thread ("${sel.slice(0, 40).replace(/\n/g, ' ')}")`, sel.length > 5)
// composer: Enter sends (demo streams a reply)
await page.getByPlaceholder(/Reply|Antworten/).click(); await page.keyboard.type('Hello from the desktop test')
await page.keyboard.press('Enter'); await page.waitForTimeout(900)
ok('Enter sends message', await page.locator('.hk-thread').getByText('Hello from the desktop test').count() === 1)
// ⌘N new chat dialog
await page.locator('body').click({ position: { x: 300, y: 700 } }); await page.keyboard.press('n'); await page.waitForTimeout(300)
ok('n opens new chat (⌘N is reserved by Chrome; the desktop app gets ⌘N)', await page.getByPlaceholder(/What is it about|Worum geht es/).isVisible())
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
ok('Esc closes dialog', !(await page.getByPlaceholder(/What is it about|Worum geht es/).isVisible()))
// right-click context menu (browser popover)
await page.getByText('Daily summary').click({ button: 'right' }); await page.waitForTimeout(300)
ok('right-click menu', await page.getByText(/Titel kopieren|Copy title/).isVisible())
await page.screenshot({ path: '/tmp/hu-spike/i-contextmenu.png' })
await page.keyboard.press('Escape')
// drag & drop "Idea" card from New Task to Done
const card = page.getByText('Idea: test the onboarding email')
const done = page.getByText('Done', { exact: true }).first()
await card.dragTo(done); await page.waitForTimeout(800)
const doneCount = await page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.textContent?.trim().startsWith('Done') && d.textContent.length < 12)?.textContent)
ok(`drag card to Done (header "${doneCount}")`, /Done\s*3/.test(doneCount || ''))
// split resize
await page.getByText('Daily summary').click(); await page.waitForTimeout(500)
const handle = page.locator('[aria-label="Breite ändern"], [aria-label="Resize"]').first()
const b0 = await handle.boundingBox()
if (b0) { await page.mouse.move(b0.x + 2, b0.y + 300); await page.mouse.down(); await page.mouse.move(b0.x - 150, b0.y + 300, { steps: 8 }); await page.mouse.up() }
const b1 = await handle.boundingBox()
ok(`split resize (${b0 && Math.round(b0.x)} → ${b1 && Math.round(b1.x)})`, b0 && b1 && b1.x < b0.x - 100)
await page.screenshot({ path: '/tmp/hu-spike/i-final.png' })
ok(`no page errors ${errors.join(' | ')}`, errors.length === 0)
await browser.close()

// Media: lightbox (Esc closes only the lightbox), voice message (MediaRecorder, fake microphone),
// image pasted into the composer.
const mb = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit' ? {} : { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const mctx = await mb.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', ...(engine === 'webkit' ? {} : { permissions: ['microphone'] }) })
const mp = await mctx.newPage()
await mp.goto('http://127.0.0.1:8811/demo?thread=demo-site', { waitUntil: 'networkidle' }); await mp.waitForTimeout(1500)
await mp.locator('.hk-thread').evaluate((el) => { el.scrollTop = -100000 }); await mp.waitForTimeout(800)
const img = mp.locator('.hk-thread img').first()
ok('image in thread renders', (await img.count()) > 0 && (await img.evaluate((i) => i.naturalWidth)) > 0)
await img.click(); await mp.waitForTimeout(600)
ok('lightbox opens', (await mp.locator('img').count()) >= 2)
await mp.keyboard.press('Escape'); await mp.waitForTimeout(600)
ok('Esc closes the lightbox, the chat stays open', (await mp.locator('img').count()) === 1 && (await mp.locator('.hk-thread').count()) === 1)
if (engine !== 'webkit') {
  await mp.locator('[aria-label="Voice message"]').click(); await mp.waitForTimeout(1500)
  ok('recording state shown', await mp.getByText(/Recording/).isVisible())
  await mp.locator('[aria-label="Send recording"]').click(); await mp.waitForTimeout(2000)
  ok('voice message sent', await mp.locator('.hk-thread').getByText(/voice message/).count() > 0)
}
await mp.getByPlaceholder('Reply …').click()
await mp.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'x.png', { type: 'image/png' }))
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await mp.waitForTimeout(600)
ok('pasted image becomes an attachment', await mp.locator('[aria-label="Remove image"]').count() === 1)
if (engine !== 'webkit') {
  // Camera: live preview (fake device), the shot becomes a second attachment.
  await mctx.grantPermissions(['microphone', 'camera'])
  await mp.locator('[aria-label="Take photo"]').first().click(); await mp.waitForTimeout(1500)
  await mp.getByRole('button', { name: 'Take photo' }).last().click(); await mp.waitForTimeout(800)
  ok('camera photo becomes an attachment', await mp.locator('[aria-label="Remove image"]').count() === 2)
}
await mb.close()

// Refused microphone / camera: a notice with the way to the settings instead of a silent failure.
if (engine !== 'webkit') {
  const db = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] })
  const dctx = await db.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  const dp = await dctx.newPage()
  await dp.goto('http://127.0.0.1:8811/demo?thread=demo-site', { waitUntil: 'networkidle' }); await dp.waitForTimeout(1500)
  await dp.addInitScript(() => {})
  await dp.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) })
  await dp.locator('[aria-label="Voice message"]').click(); await dp.waitForTimeout(800)
  ok('refused microphone shows a notice', await dp.getByText('Microphone not allowed').isVisible())
  await dp.locator('[aria-label="Take photo"]').first().click(); await dp.waitForTimeout(800)
  ok('refused camera shows a notice', await dp.getByText('Camera not allowed').isVisible())
  await db.close()
}
