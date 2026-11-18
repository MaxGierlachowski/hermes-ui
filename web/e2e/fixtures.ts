// Synthetic data for the UI tests: no real chats, no backend. Every timestamp is relative to NOW, and the
// tests freeze the browser clock at NOW, so relative times ("3 min") and countdowns render the same each run.
import type { InboxItem, OpenItem, PaseoAgent, PaseoChip, PaseoItem, PendingPrompt, Session, ThreadMessage } from '../src/lib/types'

export const NOW = Date.parse('2026-11-18T13:00:00Z') / 1000

const agent = (id: string, title: string, state: PaseoChip['state'], extra: Partial<PaseoChip> = {}): PaseoChip => ({
  id, title, state, status: state, rel: 'created', account: '02', kind: 'claude', archived: false, pendingCount: 0,
  createdAt: new Date((NOW - 1500) * 1000).toISOString(), updatedAt: new Date((NOW - 120) * 1000).toISOString(), ...extra,
})

const approval: PendingPrompt = {
  promptId: 'p-approval', kind: 'approval', generation: 1, command: 'rm -rf web/dist && npm run build',
  description: 'Build-Ordner löschen und neu bauen', question: null, choices: ['once', 'session', 'always', 'deny'],
  multiSelect: false, edit: null, timeoutS: null, at: (NOW - 40) * 1000,
}
const clarify: PendingPrompt = {
  promptId: 'p-clarify', kind: 'clarify', generation: 1, command: null, description: null,
  question: 'Soll ich den Release-Branch vor dem Merge noch rebasen?', choices: ['Ja, rebasen (recommended)', 'Nein, direkt mergen', 'Erst die Tests laufen lassen'],
  multiSelect: false, edit: null, timeoutS: null, at: (NOW - 90) * 1000,
}

const base = (id: string, patch: Partial<Session>): Session => ({
  id, title: 'Ohne Titel', source: 'kanban', system: false, column: 'waiting', autoColumn: 'waiting', override: false, running: false,
  activity: '', initialPrompt: '', createdAt: NOW - 3600, updatedAt: NOW - 300, messageCount: 6, test: false, pending: [], paseo: [], paseoNote: '', ...patch,
})

export const SESSIONS: Session[] = [
  base('s-approval', {
    title: 'Landingpage-Build reparieren und deployen', pending: [approval], updatedAt: NOW - 40, messageCount: 14,
    initialPrompt: 'Der Build der Landingpage schlägt fehl, bitte reparieren',
    paseo: [agent('a-running', 'Fix Astro build', 'running'), agent('a-done', 'Lighthouse-Check', 'finished')],
  }),
  base('s-clarify', { title: 'Release 1.4 vorbereiten', pending: [clarify], source: 'slack', updatedAt: NOW - 90, messageCount: 9 }),
  base('s-waiting', { title: 'Wochenbericht für das Team zusammenfassen', activity: '💬 Fertig: Bericht steht im Thread', updatedAt: NOW - 1800, initialPrompt: 'Fass die Woche zusammen' }),
  base('s-doing', { title: 'Inbox nach Partneranfragen durchsuchen', column: 'doing', autoColumn: 'doing', running: true, activity: 'Liest 24 Threads …', source: 'desktop', updatedAt: NOW - 20 }),
  base('s-doing-2', { title: 'Logs vom Staging-Deploy prüfen', column: 'doing', autoColumn: 'doing', running: true, activity: 'grep -r "ERROR" logs/', source: 'cli', updatedAt: NOW - 60, paseo: [agent('a-2', 'Staging smoke test', 'running')] }),
  base('s-new', { title: 'Idee: Onboarding-Mail testen', column: 'new', autoColumn: 'new', draft: true, messageCount: 0, updatedAt: NOW - 7200 }),
  base('s-done', { title: 'Rechnungen aus Gmail exportieren', column: 'done', autoColumn: 'done', override: true, updatedAt: NOW - 86400, messageCount: 22 }),
  base('s-done-2', { title: 'Cron: tägliche Zusammenfassung', column: 'done', autoColumn: 'done', source: 'cron', updatedAt: NOW - 40000, messageCount: 3 }),
]

const IMG = '/tmp/hermes-ui-e2e/screenshot.png'

export const MESSAGES: ThreadMessage[] = [
  { id: 1, role: 'user', text: 'Der Build der Landingpage schlägt fehl, bitte reparieren. Screenshot vom Fehler anbei.', ts: NOW - 3600, attachments: [{ kind: 'image', url: IMG }] },
  { id: 2, role: 'tool', text: '$ npm run build\nerror: Cannot find module "@astrojs/cloudflare"', ts: NOW - 3590, toolName: 'terminal', summary: 'npm run build' },
  { id: 3, role: 'tool', text: '', ts: NOW - 3580, toolName: 'read_file', summary: 'astro.config.mjs' },
  { id: 4, role: 'assistant', ts: NOW - 3500, text: 'Gefunden: Das Adapter-Paket fehlt in `package.json`.\n\n1. `@astrojs/cloudflare` installieren\n2. Build neu starten\n3. Preview prüfen\n\n```bash\npnpm add -D @astrojs/cloudflare@14\n```\n\nDetails stehen in https://docs.astro.build/en/guides/integrations-guide/cloudflare/#installation-and-configuration-of-the-adapter' },
  { id: 5, role: 'event', ts: NOW - 3000, text: '## Deploy fehlgeschlagen\n\nWorker `move2pay-landing-staging` meldet Status 500.', event: { source: 'webhook', route: 'cloudflare', title: 'Deploy fehlgeschlagen' } },
  { id: 6, role: 'paseo', ts: NOW - 2900, text: '', paseo: { action: 'create', ref: 'a-running', agentId: 'a-running', title: 'Fix Astro build', account: '02' } },
  { id: 7, role: 'assistant', ts: NOW - 2000, text: 'Ein Paseo-Agent repariert den Build. Sobald er fertig ist, deploye ich auf Staging.' },
  { id: 8, role: 'user', ts: NOW - 600, text: 'Bitte danach auch die Lighthouse-Werte posten.', outbox: { id: 'o-1', status: 'failed', error: 'Gateway nicht erreichbar' } },
  { id: 9, role: 'assistant', ts: NOW - 60, text: 'Mache ich. Für den Neuaufbau brauche ich deine Freigabe.' },
]

export const PASEO_AGENTS: PaseoAgent[] = [
  { ...agent('a-running', 'Fix Astro build', 'running'), known: true, goal: 'Landingpage-Build reparieren', cwd: '/Users/dev/move2pay-landing', model: 'opus', deepLink: 'paseo://agent/a-running' },
  { ...agent('a-done', 'Lighthouse-Check', 'finished'), known: true, cwd: '/Users/dev/move2pay-landing', deepLink: 'paseo://agent/a-done' },
]

export const PASEO_TIMELINE: { agent: PaseoAgent; items: PaseoItem[]; hasOlder: boolean } = {
  agent: PASEO_AGENTS[0],
  hasOlder: true,
  items: [
    { role: 'user', text: 'Repariere den Build der Landingpage.', ts: NOW - 1500 },
    { role: 'tool', toolName: 'Bash', summary: 'pnpm install', text: 'Done in 4.2s', ts: NOW - 1400, status: 'completed' },
    { role: 'todo', ts: NOW - 1300, todos: [{ text: 'Adapter installieren', done: true }, { text: 'Build prüfen', done: false }] },
    { role: 'assistant', text: 'Der Adapter ist installiert, der Build läuft wieder.', ts: NOW - 1200 },
  ],
}

export const OPEN: OpenItem[] = [
  { key: 'o-approval', source: 'hermes', kind: 'approval', sessionId: 's-approval', title: 'Landingpage-Build reparieren und deployen', at: NOW - 40, prompt: approval },
  {
    key: 'o-paseo', source: 'paseo', kind: 'permission', sessionId: 's-approval', title: 'Landingpage-Build reparieren und deployen', at: NOW - 200, canRespond: true,
    agent: { id: 'a-running', title: 'Fix Astro build', account: '02', cwd: '/Users/dev/move2pay-landing', deepLink: 'paseo://agent/a-running' },
    permission: { id: 'perm-1', kind: 'tool', name: 'Bash', title: 'Bash: git push', description: 'Pusht den Fix auf den Feature-Branch.', command: 'git push origin fix/astro-adapter', actions: null },
  },
]

export const INBOX_ITEMS: InboxItem[] = [
  { id: 'i-1', kind: 'done', source: 'hermes', sessionId: 's-waiting', title: 'Wochenbericht für das Team zusammenfassen', text: 'Bericht steht im Thread.', at: NOW - 1800, read: false },
  { id: 'i-2', kind: 'paseo-done', source: 'paseo', sessionId: 's-approval', title: 'Landingpage-Build reparieren und deployen', agentTitle: 'Lighthouse-Check', agentId: 'a-done', text: 'Performance 98, Accessibility 100.', at: NOW - 2400, read: false },
  { id: 'i-3', kind: 'error', source: 'hermes', sessionId: 's-done', title: 'Rechnungen aus Gmail exportieren', text: 'Gmail-API: quota exceeded', at: NOW - 5000, read: true },
  { id: 'i-4', kind: 'approval', source: 'hermes', sessionId: 's-done', title: 'Rechnungen aus Gmail exportieren', text: 'mkdir -p ~/Rechnungen', at: NOW - 90000, read: true, resolution: { at: NOW - 89900, by: 'ui', choice: 'once', device: 'iPhone · Safari' } },
]

// Small stand-in for transcript images (served for every /api/file request).
export const IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
<rect width="800" height="500" fill="#1e1b4b"/><rect x="40" y="40" width="720" height="60" rx="10" fill="#312e81"/>
<rect x="40" y="130" width="460" height="24" rx="6" fill="#ef4444"/><rect x="40" y="170" width="620" height="16" rx="6" fill="#6366f1"/>
<rect x="40" y="200" width="540" height="16" rx="6" fill="#6366f1"/><rect x="40" y="230" width="380" height="16" rx="6" fill="#6366f1"/></svg>`
