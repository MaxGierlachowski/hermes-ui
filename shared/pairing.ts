// Pairing links: <ui-url>/#iroh=<gateway endpoint id>&relay=<relay url>&pair=<one-time code>
// (from `hermes-ui pair` or the remote dialog). The native app also accepts
// hermesui://pair?iroh=…&relay=…&pair=… and the bare fragment.

export type PairingLink = { endpointId: string; relayUrl?: string; code?: string }

export function parsePairingLink(input: string): PairingLink | null {
  const text = input.trim()
  if (!text) return null
  let params: URLSearchParams
  const hash = text.indexOf('#')
  const query = text.indexOf('?')
  if (hash >= 0) params = new URLSearchParams(text.slice(hash + 1))
  else if (query >= 0) params = new URLSearchParams(text.slice(query + 1))
  else params = new URLSearchParams(text)
  const endpointId = (params.get('iroh') || '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(endpointId)) return null
  return { endpointId, relayUrl: params.get('relay') || undefined, code: params.get('pair') || undefined }
}
