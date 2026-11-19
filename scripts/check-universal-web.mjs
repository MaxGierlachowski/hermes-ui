#!/usr/bin/env node
// Interaction check of the universal app's wide (desktop) layout in the demo mode: ⌘K palette, keyboard
// navigation, Esc, text selection, Enter to send, new chat, right-click menu, drag & drop between columns,
// split resize. Serve mobile-app/dist-web on :8811 first (static, index.html fallback).
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
