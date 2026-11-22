import { expect, test, type Page } from '@playwright/test'
import { SESSIONS } from './fixtures'
import { mockApi } from './mock'
import type { ModelOptions, OutgoingMessage } from '../src/lib/types'

// The "new chat" model picker: offered when the backend lists models (GET /api/models), and a pick is sent
// as model + provider on POST /api/sessions. Without a pick neither field is sent (gateway default).

const MODELS: ModelOptions = {
  current: { model: 'claude-opus-5-5', provider: 'anthropic' },
  providers: [
    { slug: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
    { slug: 'openrouter', name: 'OpenRouter', models: ['google/gemini-2.5-pro'] },
  ],
}

async function openNewChat(page: Page, models: ModelOptions | null) {
  await mockApi(page)
  const created: OutgoingMessage[] = []
  // Registered after mockApi, so these win for their paths; everything else stays mocked.
  await page.route('**/api/models', (route) => (models
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(models) })
    : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Hermes gateway not connected"}' })))
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    created.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { ...SESSIONS[2], id: 's-created', title: 'Neu' } }) })
  })
  await page.goto('/#/board')
  await page.getByText('Landingpage-Build reparieren und deployen').first().waitFor()
  await page.getByRole('button', { name: 'Neuer Chat' }).last().click()
  await page.getByRole('dialog').waitFor()
  return created
}

const send = async (page: Page, text: string) => {
  await page.getByPlaceholder('Was soll Hermes tun?').fill(text)
  await page.getByRole('dialog').getByTestId('send').click()
}

test('a picked model is sent with the new chat', async ({ page }) => {
  const created = await openNewChat(page, MODELS)
  const picker = page.getByRole('combobox', { name: 'Modell' })
  await expect(picker).toHaveText('Standard (claude-opus-5-5)')
  await picker.click()
  await expect(page.getByRole('option')).toHaveCount(5)
  await page.getByRole('option', { name: 'claude-sonnet-5-5' }).click()
  await expect(picker).toHaveText('claude-sonnet-5-5')
  await send(page, 'Bitte mit Sonnet')
  await expect.poll(() => created.length).toBe(1)
  expect(created[0]).toMatchObject({ text: 'Bitte mit Sonnet', model: 'claude-sonnet-5-5', provider: 'anthropic' })
})

test('the default leaves model and provider out', async ({ page }) => {
  const created = await openNewChat(page, MODELS)
  await expect(page.getByRole('combobox', { name: 'Modell' })).toBeVisible()
  await send(page, 'Wie immer')
  await expect.poll(() => created.length).toBe(1)
  expect(created[0].text).toBe('Wie immer')
  expect(created[0]).not.toHaveProperty('model')
  expect(created[0]).not.toHaveProperty('provider')
})

test('no picker when the backend cannot list models', async ({ page }) => {
  const created = await openNewChat(page, null)
  await expect(page.getByRole('switch')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Modell' })).toHaveCount(0)
  await send(page, 'Ohne Gateway-Liste')
  await expect.poll(() => created.length).toBe(1)
  expect(created[0]).not.toHaveProperty('model')
})
