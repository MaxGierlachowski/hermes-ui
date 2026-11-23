import { expect, test } from '@playwright/test'
import type { PaseoAgent, Session } from '../src/lib/types'
import { mockApi } from './mock'
import { NOW, SESSIONS } from './fixtures'

// Agent linking (server/src/agent-links.mjs): the chat's own agent hit a usage limit and was archived; a
// successor another run started (labels.predecessor) is still at work, so the card stays in Doing and the
// agent list shows the chain. Attach / detach go to the backend.
const iso = (s: number) => new Date(s * 1000).toISOString()
const PRED: PaseoAgent = {
  id: '1a2b3c4d-0000-4000-8000-000000000001', title: 'Fix login flow', state: 'archived', status: 'idle', rel: 'created', account: '01', kind: 'claude',
  archived: true, pendingCount: 0, known: true, createdAt: iso(NOW - 7200), updatedAt: iso(NOW - 3600),
}
const SUCC: PaseoAgent = {
  id: '5e6f7a8b-0000-4000-8000-000000000002', title: 'Fix login flow (continued)', state: 'running', status: 'running', rel: 'created', account: '02', kind: 'claude',
  archived: false, pendingCount: 0, known: true, createdAt: iso(NOW - 3500), updatedAt: iso(NOW - 30), via: 'successor', successorOf: PRED.id, predecessorTitle: PRED.title,
}
const OTHER = { id: '9c0d1e2f-0000-4000-8000-000000000003', title: 'Nightly dependency check', state: 'idle', status: 'idle', account: '01', kind: 'claude', cwd: '/home/dev/app', updatedAt: iso(NOW - 600), createdAt: iso(NOW - 900) }
const chip = ({ known: _k, ...a }: PaseoAgent) => a
const CARD: Session = {
  ...SESSIONS[4], id: 's-successor', title: 'Login-Flow reparieren', column: 'doing', autoColumn: 'waiting', running: true, pending: [],
  activity: 'Paseo: 1 Agent läuft: Fix login flow (continued)', paseoNote: 'Paseo: 1 Agent läuft: Fix login flow (continued)',
  paseo: [chip(SUCC), chip(PRED)], updatedAt: NOW - 30,
}

test('a card stays in Doing while a successor agent runs, and the chain shows in the agent list', async ({ page }) => {
  await mockApi(page)
  const calls: string[] = []
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api\//, '/api/')
    const method = route.request().method()
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/api/sessions' && method === 'GET') return json({ sessions: [CARD, ...SESSIONS.filter((s) => s.id !== CARD.id)], gateway: true })
    if (p === '/api/sessions/s-successor') return json({ session: CARD, messages: [{ id: 1, role: 'user', text: 'Bitte den Login-Flow reparieren', ts: NOW - 7300, attachments: [] }] })
    if (p === '/api/sessions/s-successor/paseo') return json({ connected: true, source: 'daemon', agents: [SUCC, PRED] })
    if (p === '/api/paseo/agents') return json({ connected: true, agents: [{ ...SUCC }, OTHER] })
    if (p.startsWith('/api/sessions/s-successor/agents')) {
      calls.push(`${method} ${p}${method === 'POST' ? ` ${route.request().postData()}` : ''}`)
      return json({ session: CARD, agents: method === 'POST' ? [SUCC, { ...OTHER, rel: 'created', archived: false, pendingCount: 0, known: true, via: 'manual' }, PRED] : [PRED] })
    }
    return route.fallback()
  })
  await page.goto('/#/board')
  const doing = page.locator('[class*="grid-cols-4"] > div').nth(1)
  const card = doing.getByText('Login-Flow reparieren')
  await expect(card).toBeVisible()
  await page.waitForTimeout(350)
  await expect(doing.locator('[class*="group/card"]').filter({ hasText: 'Login-Flow reparieren' })).toHaveScreenshot('successor-card-doing.png')

  await card.click()
  await page.getByRole('button', { name: /Paseo-Agents/ }).click()
  await expect(page.getByText('Nachfolger von Fix login flow')).toBeVisible()

  await page.getByText('Agent anhängen…').click()
  const picker = page.locator('[data-slot="popover-content"]')
  await expect(picker.getByText('Nightly dependency check')).toBeVisible()
  await expect(picker.getByText('Fix login flow (continued)')).toHaveCount(0) // already linked: not offered again
  await picker.getByText('Nightly dependency check').click()
  await expect(page.getByText('von Hand angehängt')).toBeVisible()
  expect(calls[0]).toBe(`POST /api/sessions/s-successor/agents {"agentId":"${OTHER.id}"}`)

  await page.getByRole('button', { name: 'Lösen' }).first().click()
  expect(calls[1]).toBe(`DELETE /api/sessions/s-successor/agents/${SUCC.id}`)
})
