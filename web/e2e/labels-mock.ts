// Stateful label endpoints on top of mockApi (registered later, so these routes win): the label list,
// per-card assignments, and /api/sessions + thread answers that carry them. Writes are recorded.
import type { Page } from '@playwright/test'
import { mockApi } from './mock'
import { MESSAGES, SESSIONS } from './fixtures'
import type { Label } from '../src/lib/types'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

export const MOUVE: Label = { id: 'l-mouve', name: 'MOUVE', color: '#a855f7' }
export const PRIVAT: Label = { id: 'l-privat', name: 'Privat', color: '#22c55e' }

export async function mockLabels(page: Page, init: { labels?: Label[]; cards?: Record<string, string[]> } = {}) {
  await mockApi(page)
  const state = { labels: [...(init.labels || [])], cards: { ...(init.cards || {}) } as Record<string, string[]> }
  const writes: { method: string; path: string; body: unknown }[] = []
  const card = (id: string) => {
    const s = SESSIONS.find((x) => x.id === id) || SESSIONS[0]
    return { ...s, labels: (state.cards[s.id] || []).filter((l) => state.labels.some((x) => x.id === l)) }
  }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^.*\/api\//, '/api/')
    const method = route.request().method()
    const body = route.request().postDataJSON?.() ?? null
    if (method !== 'GET') writes.push({ method, path: p, body })
    if (p === '/api/sessions' && method === 'GET') return route.fulfill(json({ sessions: SESSIONS.map((s) => card(s.id)), labels: state.labels, gateway: true }))
    if (p === '/api/labels' && method === 'POST') {
      const label = { id: `l-${state.labels.length + 1}-${body.name.toLowerCase()}`, name: body.name, color: body.color || '#6b7280' }
      state.labels.push(label)
      return route.fulfill(json({ label, labels: state.labels }))
    }
    let m = p.match(/^\/api\/labels\/([^/]+)$/)
    if (m) {
      const id = decodeURIComponent(m[1])
      if (method === 'PATCH') {
        state.labels = state.labels.map((l) => (l.id === id ? { ...l, ...body } : l))
        return route.fulfill(json({ label: state.labels.find((l) => l.id === id), labels: state.labels }))
      }
      if (method === 'DELETE') {
        state.labels = state.labels.filter((l) => l.id !== id)
        const touched = Object.keys(state.cards).filter((k) => state.cards[k].includes(id))
        for (const k of touched) state.cards[k] = state.cards[k].filter((x) => x !== id)
        return route.fulfill(json({ ok: true, labels: state.labels, cards: touched }))
      }
    }
    m = p.match(/^\/api\/sessions\/([^/]+)\/labels$/)
    if (m && method === 'PUT') {
      const id = decodeURIComponent(m[1])
      state.cards[id] = body.labels
      return route.fulfill(json({ labels: body.labels, session: card(id) }))
    }
    m = p.match(/^\/api\/sessions\/([^/]+)$/)
    if (m && method === 'GET') return route.fulfill(json({ session: card(decodeURIComponent(m[1])), messages: MESSAGES }))
    return route.fallback()
  })
  return { state, writes }
}
