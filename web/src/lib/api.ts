// Same-origin API. Auth is the HttpOnly device cookie (set by /api/login or pairing), so no token in JS.
import { apiUrl, getConnection } from './backend'

export class Unauthorized extends Error {}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(apiUrl(path), {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  // 403 over iroh = the gateway refuses this device (not paired or revoked).
  if (res.status === 401 || (res.status === 403 && getConnection().mode === 'iroh')) throw new Unauthorized('unauthorized')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || res.statusText)
  return body as T
}

export const fileToUpload = (file: Blob, name?: string) =>
  new Promise<{ name?: string; type: string; data: string }>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name, type: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] })
    r.onerror = reject
    r.readAsDataURL(file)
  })
