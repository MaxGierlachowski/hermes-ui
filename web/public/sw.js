// Hermes UI service worker. One worker per scope, so it combines two jobs:
//   1. iroh-fetch's bridge (iroh-sw.js, copied from the iroh-fetch package at build time): routes
//      <img>/<audio> loads of backend URLs over iroh. Inert when registered without ?hosts=.
//   2. Web Push: shows the backend's notifications and opens the right thread or inbox entry on click.
// Payloads carry no chat content: { title, body, tag, url, badge, actions?, confirm? }.

importScripts('./iroh-sw.js')

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const scope = self.registration.scope
  event.waitUntil((async () => {
    if (typeof data.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
      try { await (data.badge ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()) } catch { /* unsupported */ }
    }
    await self.registration.showNotification(data.title || 'Hermes UI', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: `${scope}icon-192.png`,
      badge: `${scope}icon-192.png`,
      data: { url: data.url || '#/inbox', confirm: data.confirm || null },
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url, confirm } = event.notification.data || {}
  let hash = url || '#/inbox'
  // "Allow …" / "Deny …" never answer directly: they open the app with a confirmation dialog.
  if (confirm && (event.action === 'allow' || event.action === 'deny')) {
    hash += `?confirm=${encodeURIComponent(confirm.promptId)}&choice=${encodeURIComponent(event.action === 'deny' ? 'deny' : confirm.allow)}`
  }
  event.waitUntil((async () => {
    const scope = self.registration.scope
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = windows.find((w) => w.url.startsWith(scope))
    if (win) {
      await win.focus()
      win.postMessage({ type: 'hermes-ui:navigate', hash })
      return
    }
    await self.clients.openWindow(scope + hash)
  })())
})
