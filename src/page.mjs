// index.html as the browser gets it. <base href="{base}/"> makes every relative URL of the build (assets,
// manifest, service worker and its scope, API calls) resolve below HERMES_UI_BASE_PATH, and a meta tag
// tells the app its base path, auth mode and pairing URL (web/src/lib/backend.ts reads it). The build
// itself uses only relative URLs, so one web/dist works at / and below any prefix.

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderIndex(html, { basePath = '', auth = 'token', pairingUrl = '' } = {}) {
  const pageConfig = { base: basePath, auth, pairingUrl: auth === 'proxy' ? pairingUrl || null : null };
  const head = `<base href="${escAttr(`${basePath}/`)}">\n    <meta name="hermes-ui-config" content="${escAttr(JSON.stringify(pageConfig))}">`;
  return html.replace(/<base\s[^>]*>\s*/i, '').replace(/<head>/i, `<head>\n    ${head}`);
}
