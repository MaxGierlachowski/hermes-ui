// The thread opens with the latest window only, and scrolling to the top fetches and prepends an
// older page without losing the user's scroll position — see web/src/lib/store.ts loadOlderMessages()
// and web/src/components/thread/ThreadView.tsx LoadOlder.
import { expect, test } from '@playwright/test'
import { mockApi } from './mock'
import { NOW, SESSIONS } from './fixtures'

const OLDER = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1, role: 'assistant' as const, text: `Ältere Nachricht Nr. ${i + 1}`, ts: NOW - 7200 + i * 10,
}))
// Long enough that the top of the window is out of view on open — the real case this feature is for.
const LATEST = Array.from({ length: 20 }, (_, i) => ({
  id: i + 31, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: i === 19 ? 'Letzte Antwort' : `Jüngere Nachricht Nr. ${i + 31}`, ts: NOW - 600 + i * 20,
}))

test('a long thread opens with the latest page only, and loads older messages when scrolled to the top', async ({ page }) => {
  await mockApi(page)
  let olderRequests = 0
  await page.route('**/api/sessions/*/messages?*', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET') return route.fallback()
    olderRequests++
    const before = Number(url.searchParams.get('before'))
    expect(before).toBe(31) // the oldest id currently loaded
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: OLDER, hasMore: false }) })
  })
  await page.route('**/api/sessions/s-approval', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: SESSIONS[0], messages: LATEST, hasMore: true }) })
  })

  await page.goto('/#/board/s-approval')
  await expect(page.getByText('Letzte Antwort')).toBeVisible()
  await expect(page.getByText('Ältere Nachricht Nr. 1', { exact: true })).not.toBeAttached()

  const scroller = page.getByRole('log')
  await scroller.evaluate((el) => { el.scrollTop = 0 })
  await expect(page.getByText('Ältere Nachricht Nr. 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Letzte Antwort')).toBeVisible() // still mounted, nothing was replaced
  expect(olderRequests).toBe(1)

  // Scrolling to the (new) top again does not re-fetch: hasMore was false.
  await scroller.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(300)
  expect(olderRequests).toBe(1)
})
