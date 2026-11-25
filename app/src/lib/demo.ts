// Demo mode: the whole app without a backend. A stand-in for the iroh connection answers the same
// API paths and sends the same live events as hermes-ui, from made-up sample data (English or German,
// like the app). Sending a message plays a streamed reply. Nothing leaves the device.
//
// It exists so that anyone, app reviewers included, can try the app without running a backend.
import { File } from 'expo-file-system'
import type { InboxItem, OpenItem, PaseoAgent, PaseoChip, PaseoItem, PendingPrompt, Session, ThreadMessage } from '@shared/types'
import type { Backend } from './connection'
import { lang } from './i18n'
import { DEMO_IMAGE_URI } from './demo-image'
import { DEMO_FILES_SESSION, demoFileBytes, demoFileMessages, demoFileText, demoFileUrl } from './demo-files'

const L = (en: string, de: string) => (lang === 'de' ? de : en)
const now = () => Math.floor(Date.now() / 1000)
// Served by download() below into the media cache, like a real backend image.
const DEMO_IMAGE = '/api/media/demo/build-error.jpg'

// ---------- sample data (built once per demo start, relative to "now") ----------
type Data = {
  sessions: Map<string, Session>
  messages: Map<string, ThreadMessage[]>
  open: OpenItem[]
  items: InboxItem[]
  agents: PaseoAgent[]
  timelines: Map<string, PaseoItem[]>
}

function build(): Data {
  const T = now()
  const chip = (id: string, title: string, state: PaseoChip['state']): PaseoChip => ({
    id, title, state, status: state, rel: 'created', account: null, kind: 'claude', archived: false, pendingCount: 0,
    createdAt: new Date((T - 1500) * 1000).toISOString(), updatedAt: new Date((T - 120) * 1000).toISOString(),
  })
  const approval: PendingPrompt = {
    promptId: 'demo-approval', kind: 'approval', generation: 1, command: 'rm -rf dist && npm run build',
    description: L('Delete the build folder and build again', 'Build-Ordner löschen und neu bauen'), question: null,
    choices: ['once', 'session', 'always', 'deny'], multiSelect: false, edit: null, timeoutS: null, at: (T - 40) * 1000,
  }
  const clarify: PendingPrompt = {
    promptId: 'demo-clarify', kind: 'clarify', generation: 1, command: null, description: null,
    question: L('Should I rebase the release branch before merging?', 'Soll ich den Release-Branch vor dem Merge noch rebasen?'),
    choices: [L('Yes, rebase (recommended)', 'Ja, rebasen (empfohlen)'), L('No, merge directly', 'Nein, direkt mergen'), L('Run the tests first', 'Erst die Tests laufen lassen')],
    multiSelect: false, edit: null, timeoutS: null, at: (T - 90) * 1000,
  }
  const s = (id: string, p: Partial<Session>): Session => ({
    id, title: '', source: 'kanban', system: false, column: 'waiting', autoColumn: 'waiting', override: false, running: false,
    activity: '', initialPrompt: '', createdAt: T - 3600, updatedAt: T - 300, messageCount: 4, test: false, pending: [], paseo: [], paseoNote: '', ...p,
  })
  const sessions = [
    s('demo-site', {
      title: L('Fix the landing page build and deploy it', 'Landingpage-Build reparieren und deployen'), pending: [approval], updatedAt: T - 40, messageCount: 9,
      initialPrompt: L('The landing page build fails, please fix it', 'Der Build der Landingpage schlägt fehl, bitte reparieren'),
      paseo: [chip('demo-agent-fix', 'Fix Astro build', 'running'), chip('demo-agent-lh', 'Lighthouse check', 'finished')],
    }),
    s('demo-release', { title: L('Prepare release 1.4', 'Release 1.4 vorbereiten'), pending: [clarify], source: 'slack', updatedAt: T - 90 }),
    s('demo-research', { title: L('Compare three vector databases', 'Drei Vektordatenbanken vergleichen'), column: 'doing', autoColumn: 'doing', running: true, activity: L('Reading 12 pages …', 'Liest 12 Seiten …'), source: 'desktop', updatedAt: T - 20 }),
    s('demo-logs', { title: L('Check the staging deploy logs', 'Logs vom Staging-Deploy prüfen'), column: 'doing', autoColumn: 'doing', running: true, activity: 'grep -r "ERROR" logs/', source: 'cli', updatedAt: T - 60, paseo: [chip('demo-agent-smoke', 'Staging smoke test', 'running')] }),
    s('demo-weekly', { title: L('Summarise the week for the team', 'Wochenbericht für das Team zusammenfassen'), activity: L('💬 Done: the summary is in the thread', '💬 Fertig: Bericht steht im Thread'), updatedAt: T - 1800 }),
    s('demo-idea', { title: L('Idea: test the onboarding email', 'Idee: Onboarding-Mail testen'), column: 'new', autoColumn: 'new', draft: true, messageCount: 0, updatedAt: T - 7200 }),
    s('demo-invoices', { title: L('Export last month’s invoices', 'Rechnungen vom letzten Monat exportieren'), column: 'done', autoColumn: 'done', override: true, updatedAt: T - 86400, messageCount: 12 }),
    s('demo-daily', { title: L('Daily summary', 'Tägliche Zusammenfassung'), column: 'done', autoColumn: 'done', source: 'cron', updatedAt: T - 40000, messageCount: 3 }),
    s(DEMO_FILES_SESSION, { title: L('Q3 Lighthouse report for the landing page', 'Lighthouse-Bericht Q3 für die Landingpage'), activity: L('💬 Done: the report is attached', '💬 Fertig: Bericht hängt an'), source: 'desktop', updatedAt: T - 900, messageCount: 4 }),
  ]

  const messages = new Map<string, ThreadMessage[]>()
  messages.set('demo-site', [
    { id: 1, role: 'user', ts: T - 3600, text: L('The landing page build fails, please fix it. Screenshot of the error attached.', 'Der Build der Landingpage schlägt fehl, bitte reparieren. Screenshot vom Fehler anbei.'), attachments: [{ kind: 'image', url: DEMO_IMAGE }] },
    { id: 2, role: 'tool', ts: T - 3590, toolName: 'terminal', summary: 'npm run build', text: '$ npm run build\nerror: Cannot find module "@astrojs/cloudflare"' },
    { id: 3, role: 'tool', ts: T - 3580, toolName: 'read_file', summary: 'astro.config.mjs', text: '' },
    { id: 4, role: 'assistant', ts: T - 3500, text: L(
      'Found it: the adapter package is missing from `package.json`.\n\n1. Install `@astrojs/cloudflare`\n2. Run the build again\n3. Check the preview\n\n```bash\nnpm install -D @astrojs/cloudflare\n```',
      'Gefunden: Das Adapter-Paket fehlt in `package.json`.\n\n1. `@astrojs/cloudflare` installieren\n2. Build neu starten\n3. Preview prüfen\n\n```bash\nnpm install -D @astrojs/cloudflare\n```') },
    { id: 5, role: 'event', ts: T - 3000, text: L('## Deploy failed\n\nThe staging site answers with status 500.', '## Deploy fehlgeschlagen\n\nDie Staging-Seite antwortet mit Status 500.'), event: { source: 'webhook', route: 'ci', title: L('Deploy failed', 'Deploy fehlgeschlagen') } },
    { id: 6, role: 'paseo', ts: T - 2900, text: '', paseo: { action: 'create', ref: 'demo-agent-fix', agentId: 'demo-agent-fix', title: 'Fix Astro build', account: null } },
    { id: 7, role: 'assistant', ts: T - 2000, text: L('A coding agent is fixing the build. Once it is done I will deploy to staging.', 'Ein Coding-Agent repariert den Build. Sobald er fertig ist, deploye ich auf Staging.') },
    { id: 8, role: 'user', ts: T - 600, text: L('Please post the Lighthouse scores afterwards.', 'Bitte danach auch die Lighthouse-Werte posten.') },
    { id: 9, role: 'assistant', ts: T - 60, text: L('Will do. To rebuild I need your approval.', 'Mache ich. Für den Neuaufbau brauche ich deine Freigabe.') },
  ])
  messages.set('demo-release', [
    { id: 1, role: 'user', ts: T - 900, text: L('Prepare release 1.4: changelog, version bump, release branch.', 'Bereite Release 1.4 vor: Changelog, Version erhöhen, Release-Branch.') },
    { id: 2, role: 'tool', ts: T - 880, toolName: 'terminal', summary: 'git log v1.3.0..HEAD --oneline', text: '24 commits' },
    { id: 3, role: 'assistant', ts: T - 300, text: L('The changelog is ready (24 commits, 3 features, 9 fixes). The branch `release/1.4` is 2 commits behind `main`.', 'Der Changelog steht (24 Commits, 3 Features, 9 Fixes). Der Branch `release/1.4` ist 2 Commits hinter `main`.') },
  ])
  messages.set('demo-research', [
    { id: 1, role: 'user', ts: T - 400, text: L('Compare three vector databases for a small self-hosted project: setup, memory use, licence.', 'Vergleiche drei Vektordatenbanken für ein kleines selbst gehostetes Projekt: Setup, Speicherbedarf, Lizenz.') },
    { id: 2, role: 'tool', ts: T - 380, toolName: 'web_search', summary: 'self-hosted vector database comparison', text: '' },
  ])
  messages.set(DEMO_FILES_SESSION, demoFileMessages(T, L))
  messages.set('demo-weekly', [
    { id: 1, role: 'user', ts: T - 2400, text: L('Summarise the week for the team.', 'Fass die Woche für das Team zusammen.') },
    { id: 2, role: 'assistant', ts: T - 1800, text: L(
      '**Week 47**\n\n- Release 1.3 shipped on Tuesday ([release notes](https://example.com/releases/1.3))\n- Build time down from 6 to 2 minutes\n- 2 open bugs, both with a fix in review\n\n| Area | Status |\n|---|---|\n| Release 1.3 | shipped |\n| Build time | 2 min (was 6) |\n| Open bugs | 2, fixes in review |\n\nNext week: release 1.4, see `CHANGELOG.md`.',
      '**KW 47**\n\n- Release 1.3 am Dienstag ausgeliefert ([Release Notes](https://example.com/releases/1.3))\n- Build-Zeit von 6 auf 2 Minuten gesenkt\n- 2 offene Bugs, beide mit Fix im Review\n\n| Bereich | Stand |\n|---|---|\n| Release 1.3 | ausgeliefert |\n| Build-Zeit | 2 min (vorher 6) |\n| Offene Bugs | 2, Fixes im Review |\n\nNächste Woche: Release 1.4, siehe `CHANGELOG.md`.') },
  ])

  const agents: PaseoAgent[] = [
    { ...chip('demo-agent-fix', 'Fix Astro build', 'running'), known: true, goal: L('Fix the landing page build', 'Landingpage-Build reparieren'), cwd: '~/projects/landing', model: 'claude', deepLink: null },
    { ...chip('demo-agent-lh', 'Lighthouse check', 'finished'), known: true, cwd: '~/projects/landing', deepLink: null },
    { ...chip('demo-agent-smoke', 'Staging smoke test', 'running'), known: true, cwd: '~/projects/landing', deepLink: null },
  ]
  const timelines = new Map<string, PaseoItem[]>()
  timelines.set('demo-agent-fix', [
    { role: 'user', ts: T - 1500, text: L('Fix the landing page build.', 'Repariere den Build der Landingpage.') },
    { role: 'tool', ts: T - 1400, toolName: 'Bash', summary: 'npm install', text: 'added 1 package in 4.2s', status: 'completed' },
    { role: 'todo', ts: T - 1300, todos: [{ text: L('Install the adapter', 'Adapter installieren'), done: true }, { text: L('Check the build', 'Build prüfen'), done: false }] },
    { role: 'assistant', ts: T - 1200, text: L('The adapter is installed and the build works again.', 'Der Adapter ist installiert, der Build läuft wieder.') },
  ])

  const open: OpenItem[] = [
    { key: 'demo-o1', source: 'hermes', kind: 'approval', sessionId: 'demo-site', title: sessions[0].title, at: T - 40, prompt: approval },
    { key: 'demo-o2', source: 'hermes', kind: 'clarify', sessionId: 'demo-release', title: sessions[1].title, at: T - 90, prompt: clarify },
    {
      key: 'demo-o3', source: 'paseo', kind: 'permission', sessionId: 'demo-site', title: sessions[0].title, at: T - 200, canRespond: true,
      agent: { id: 'demo-agent-fix', title: 'Fix Astro build', account: null, cwd: '~/projects/landing', deepLink: null },
      permission: { id: 'demo-perm', kind: 'tool', name: 'Bash', title: 'Bash: git push', description: L('Pushes the fix to the feature branch.', 'Pusht den Fix auf den Feature-Branch.'), command: 'git push origin fix/astro-adapter', actions: null },
    },
  ]
  const items: InboxItem[] = [
    { id: 'demo-i1', kind: 'done', source: 'hermes', sessionId: 'demo-weekly', title: sessions[4].title, text: L('The summary is in the thread.', 'Bericht steht im Thread.'), at: T - 1800, read: false },
    { id: 'demo-i2', kind: 'paseo-done', source: 'paseo', sessionId: 'demo-site', title: sessions[0].title, agentTitle: 'Lighthouse check', agentId: 'demo-agent-lh', text: L('Performance 98, accessibility 100.', 'Performance 98, Barrierefreiheit 100.'), at: T - 2400, read: false },
    { id: 'demo-i3', kind: 'error', source: 'hermes', sessionId: 'demo-invoices', title: sessions[6].title, text: L('Mail API: quota exceeded', 'Mail-API: Kontingent erschöpft'), at: T - 5000, read: true },
  ]
  items.push(...automationItems(T))
  items.sort((a, b) => b.at - a.at)
  return { sessions: new Map(sessions.map((x) => [x.id, x])), messages, open, items, agents, timelines }
}

/** Automation entries (backend: server/src/automations.mjs, server/src/notify.mjs), folded into groups by the inbox. */
function automationItems(T: number): InboxItem[] {
  const DAY = 86400
  const auto = (id: string, source: InboxItem['source'], group: string, at: number, p: Partial<InboxItem>): InboxItem =>
    ({ id, kind: 'automation', source, group, status: 'ok', sessionId: null, title: null, text: '', at, read: true, ...p })
  const report = (day: string, issues: number, build: string) => L(
    `## Daily report, ${day}\n\n- **${issues} new issues**, 2 closed\n- Build on \`main\`: ${build}\n- Nightly backup: ok (4.2 GB)\n\n| Service | Uptime | p95 |\n|---|---|---|\n| api | 100 % | 180 ms |\n| web | 99.9 % | 240 ms |\n\nNothing needs you today.`,
    `## Tagesbericht, ${day}\n\n- **${issues} neue Issues**, 2 geschlossen\n- Build auf \`main\`: ${build}\n- Nächtliches Backup: ok (4,2 GB)\n\n| Dienst | Verfügbarkeit | p95 |\n|---|---|---|\n| api | 100 % | 180 ms |\n| web | 99,9 % | 240 ms |\n\nHeute braucht nichts dich.`)
  const green = L('green', 'grün')
  return [
    // cron "daily-report": an agent job, its newest run has a chat (demo-daily).
    auto('cron:job-daily:run-3', 'cron', 'daily-report', T - 1500, {
      sessionId: 'demo-daily', read: false, jobId: 'job-daily',
      title: L('Daily report: 3 new issues, build green', 'Tagesbericht: 3 neue Issues, Build grün'),
      text: L('Daily report – 3 new issues, 2 closed, build on main green, nightly backup ok', 'Tagesbericht – 3 neue Issues, 2 geschlossen, Build auf main grün, Backup ok'),
      body: report(L('today', 'heute'), 3, green),
    }),
    auto('cron:job-daily:run-2', 'cron', 'daily-report', T - 1500 - DAY, {
      jobId: 'job-daily', title: L('Daily report: 1 new issue, build green', 'Tagesbericht: 1 neues Issue, Build grün'),
      text: L('Daily report – 1 new issue, 2 closed, build on main green', 'Tagesbericht – 1 neues Issue, 2 geschlossen, Build auf main grün'),
      body: report(L('yesterday', 'gestern'), 1, green),
    }),
    auto('cron:job-daily:run-1', 'cron', 'daily-report', T - 1500 - 2 * DAY, {
      jobId: 'job-daily', title: L('Daily report: 5 new issues, build red', 'Tagesbericht: 5 neue Issues, Build rot'),
      text: L('Daily report – 5 new issues, build on main red (flaky test)', 'Tagesbericht – 5 neue Issues, Build auf main rot (wackliger Test)'),
      body: report(L('two days ago', 'vorgestern'), 5, L('red, a flaky test', 'rot, ein wackliger Test')),
    }),
    // cron "disk-alert": a script without an agent (no chat); the same failure three times, folded.
    auto('cron:job-disk:run-7', 'cron', 'disk-alert', T - 420, {
      status: 'error', repeat: 3, read: false, jobId: 'job-disk',
      title: L('Run failed: /var is 93 % full', 'Lauf fehlgeschlagen: /var zu 93 % voll'),
      text: L('check-disk.sh exited with code 1: /var is 93 % full (limit 90 %)', 'check-disk.sh endete mit Code 1: /var zu 93 % voll (Grenze 90 %)'),
      body: L(
        '## Error\n\n`check-disk.sh` exited with code 1.\n\n```\nFilesystem  Size  Used  Avail  Use%  Mounted on\n/dev/sda1    40G   37G   2.8G   93%  /var\n```\n\nLargest folders: `/var/log/journal` (11 GB), `/var/lib/docker` (9 GB).',
        '## Fehler\n\n`check-disk.sh` endete mit Code 1.\n\n```\nFilesystem  Size  Used  Avail  Use%  Mounted on\n/dev/sda1    40G   37G   2.8G   93%  /var\n```\n\nGrößte Ordner: `/var/log/journal` (11 GB), `/var/lib/docker` (9 GB).'),
    }),
    // cron "backup-check": Hermes blocked the run before it started.
    auto('cron:job-backup:run-4', 'cron', 'backup-check', T - 3 * 3600, {
      status: 'error', jobId: 'job-backup',
      title: L('BLOCKED (configuration): BACKUP_TARGET is not set', 'BLOCKED (configuration): BACKUP_TARGET ist nicht gesetzt'),
      text: L('The job needs BACKUP_TARGET in its environment; the run was not started.', 'Der Job braucht BACKUP_TARGET in seiner Umgebung; der Lauf wurde nicht gestartet.'),
      body: L(
        'The run was **not started**: the job needs `BACKUP_TARGET` in its environment.\n\nSet it in the job\'s configuration, then run it again:\n\n```bash\nhermes cron run backup-check\n```',
        'Der Lauf wurde **nicht gestartet**: Der Job braucht `BACKUP_TARGET` in seiner Umgebung.\n\nIn der Konfiguration des Jobs setzen und neu starten:\n\n```bash\nhermes cron run backup-check\n```'),
    }),
    // webhook "ci-pipeline": a run in the landing page chat.
    auto('webhook:ci-pipeline:run-482', 'webhook', 'ci-pipeline', T - 2 * 3600, {
      sessionId: 'demo-site',
      title: L('Pipeline #482 passed on main', 'Pipeline #482 auf main erfolgreich'),
      text: L('All 4 stages passed in 3 min 12 s; preview deployed.', 'Alle 4 Stufen in 3 min 12 s bestanden; Preview deployt.'),
      body: L(
        '**Pipeline #482** on `main` passed.\n\n1. Lint – 18 s\n2. Unit tests – 1 min 40 s (212 passed)\n3. Build – 52 s\n4. Preview deploy – 22 s\n\nThe preview is up; nothing failed.',
        '**Pipeline #482** auf `main` erfolgreich.\n\n1. Lint – 18 s\n2. Unit-Tests – 1 min 40 s (212 bestanden)\n3. Build – 52 s\n4. Preview-Deploy – 22 s\n\nDie Preview steht; nichts ist fehlgeschlagen.'),
    }),
    // notify "deploy": messages a deploy script sent (hermes-ui notify), one of them with level error and a link.
    auto('notify:3f6c1e2a-demo-deploy-2', 'notify', 'deploy', T - 240, {
      status: 'error', level: 'error', read: false, link: 'https://example.com/deploys/1042',
      title: L('Deploy failed: health check timed out', 'Deploy fehlgeschlagen: Health-Check abgelaufen'),
      text: L('web 1.4.0 – /healthz did not answer within 60 s, rolled back to 1.3.2', 'web 1.4.0 – /healthz antwortete nicht in 60 s, zurück auf 1.3.2'),
      body: L(
        'The health check of **web 1.4.0** did not answer within 60 s.\n\n- Rolled back to `1.3.2`\n- Logs: `deploy-1042.log`',
        'Der Health-Check von **web 1.4.0** antwortete nicht in 60 s.\n\n- Zurückgerollt auf `1.3.2`\n- Logs: `deploy-1042.log`'),
    }),
    auto('notify:9a41d7b0-demo-deploy-1', 'notify', 'deploy', T - 5400, {
      level: 'info',
      title: L('Deploy finished: api 2.8.1', 'Deploy fertig: api 2.8.1'),
      text: L('Rolled out to 3 of 3 hosts in 48 s', 'Auf 3 von 3 Hosts ausgerollt in 48 s'),
      body: L('Rolled out **api 2.8.1** to 3 of 3 hosts in 48 s.', '**api 2.8.1** auf 3 von 3 Hosts ausgerollt in 48 s.'),
    }),
  ]
}

// ---------- the stand-in backend ----------
type Json = Record<string, unknown>
const reply = (status: number, body: unknown) => {
  const text = JSON.stringify(body)
  return { status, ok: status >= 200 && status < 300, text: async () => text, cancel() {} }
}

const REPLIES = [
  L('Sure. I am on it: first I look at what is there, then I make the change and check it.\n\n- Read the relevant files\n- Make the change\n- Run the tests\n\nThis is the **demo mode**: with your own backend, Hermes Agent answers here.',
    'Klar, ich kümmere mich darum: Erst schaue ich mir an, was da ist, dann ändere ich es und prüfe es.\n\n- Relevante Dateien lesen\n- Änderung machen\n- Tests laufen lassen\n\nDas ist der **Demo-Modus**: Mit deinem eigenen Backend antwortet hier Hermes Agent.'),
]

/** A long conversation for performance measurements: markdown, code, lists, tool calls. */
function addLongThread(d: Data, n: number) {
  const T = now()
  const id = 'demo-long'
  const blocks = [
    L('Here is the plan for this step:\n\n1. Read the config\n2. Change the **retry policy**\n3. Run the tests\n\n```ts\nexport const retry = { attempts: 5, backoffMs: 250 }\n```', 'Hier der Plan für diesen Schritt:\n\n1. Config lesen\n2. **Retry-Policy** ändern\n3. Tests laufen lassen\n\n```ts\nexport const retry = { attempts: 5, backoffMs: 250 }\n```'),
    L('Done. The tests pass (128 of 128). Next I look at the logging, which still writes every request twice.', 'Erledigt. Die Tests laufen durch (128 von 128). Als Nächstes schaue ich mir das Logging an, das jede Anfrage noch doppelt schreibt.'),
    L('| Check | Result |\n|---|---|\n| Lint | ok |\n| Types | ok |\n| Unit tests | 128 / 128 |', '| Prüfung | Ergebnis |\n|---|---|\n| Lint | ok |\n| Typen | ok |\n| Unit-Tests | 128 / 128 |'),
  ]
  const list: ThreadMessage[] = []
  for (let i = 0; i < n; i++) {
    const ts = T - (n - i) * 60
    const k = i % 5
    if (k === 0) list.push({ id: i + 1, role: 'user', ts, text: L(`Step ${i / 5 + 1}: please continue with the next part.`, `Schritt ${i / 5 + 1}: bitte mit dem nächsten Teil weitermachen.`) })
    else if (k === 1 || k === 3) list.push({ id: i + 1, role: 'tool', ts, toolName: k === 1 ? 'terminal' : 'read_file', summary: k === 1 ? 'npm test' : 'src/retry.ts', text: k === 1 ? '$ npm test\n128 passing' : '' })
    else list.push({ id: i + 1, role: 'assistant', ts, text: blocks[i % blocks.length] })
  }
  d.messages.set(id, list)
  d.sessions.set(id, {
    id, title: L(`Long thread (${n} messages)`, `Langer Thread (${n} Nachrichten)`), source: 'desktop', system: false, column: 'waiting', autoColumn: 'waiting', override: false, running: false,
    activity: '', initialPrompt: '', createdAt: T - n * 60, updatedAt: T - 5, messageCount: n, test: false, pending: [], paseo: [], paseoNote: '',
  })
}

/** A big board: n finished chats in Done (performance measurements, /demo?board=250). */
function addBoard(d: Data, n: number) {
  const T = now()
  const topics = [L('Update the dependencies', 'Abhängigkeiten aktualisieren'), L('Answer the support ticket', 'Support-Ticket beantworten'), L('Write the release notes', 'Release Notes schreiben'), L('Check the nightly backup', 'Nächtliches Backup prüfen'), L('Tidy up the issue tracker', 'Issue-Tracker aufräumen')]
  for (let i = 0; i < n; i++) {
    const id = `demo-board-${i + 1}`
    d.sessions.set(id, {
      id, title: `${topics[i % topics.length]} #${i + 1}`, source: i % 3 ? 'kanban' : 'cli', system: false, column: 'done', autoColumn: 'done', override: false, running: false,
      activity: L('💬 Done', '💬 Fertig'), initialPrompt: topics[i % topics.length], createdAt: T - 90000 - i * 600, updatedAt: T - 86400 - i * 600, messageCount: 2 + (i % 9), test: false, pending: [], paseo: [], paseoNote: '',
    })
  }
}

export class DemoBackend implements Backend {
  readonly gateway = { endpointId: 'demo' }
  readonly endpointId = 'demo'
  private data: Data
  private listeners = new Set<(event: string, data: string) => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private nextId = 1000

  /** `longThread`: adds a chat with that many messages (/demo?long=450); `board`: that many chats in Done (/demo?board=250). */
  constructor(opts: { longThread?: number; board?: number } = {}) {
    this.data = build()
    if (opts.longThread) addLongThread(this.data, opts.longThread)
    if (opts.board) addBoard(this.data, opts.board)
  }

  connectionInfo() { return { kind: 'direct' as const, paths: [{ kind: 'demo', addr: 'demo', selected: true, rttMs: 0 }] } }
  relayProblem() { return null }

  close() { this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear() }

  events(_path: string, onEvent: (event: string, data: string) => void, onState?: (open: boolean) => void) {
    this.listeners.add(onEvent)
    setTimeout(() => { onState?.(true); onEvent('gateway', JSON.stringify({ connected: true })) }, 0)
    return () => { this.listeners.delete(onEvent) }
  }

  /** Web: the sample image as a data URL (no file system). */
  mediaUrl(path: string) {
    const file = demoFileUrl(path)
    if (file) return file
    if (path !== DEMO_IMAGE) throw new Error('not found')
    return DEMO_IMAGE_URI
  }

  async download(path: string, fileUri: string) {
    let bytes = demoFileBytes(path)
    if (!bytes) {
      if (path !== DEMO_IMAGE) return { status: 404 }
      const bin = atob(DEMO_IMAGE_URI.slice(DEMO_IMAGE_URI.indexOf(',') + 1))
      bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    }
    const file = new File(fileUri)
    if (file.exists) file.delete()
    file.create()
    file.write(bytes)
    return { status: 200 }
  }

  async fetch(path: string, init: { method?: string; json?: unknown } = {}) {
    await new Promise((r) => setTimeout(r, 120)) // a little latency, like a real connection
    const method = init.method || (init.json !== undefined ? 'POST' : 'GET')
    const body = (init.json || {}) as Json
    const [p, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    const d = this.data
    let m: RegExpMatchArray | null

    const fileText = demoFileText(path)
    if (fileText) return reply(fileText.status, fileText.body)
    if (p === '/api/sessions' && method === 'GET') return reply(200, { sessions: [...d.sessions.values()], gateway: true })
    if (p === '/api/sessions' && method === 'POST') {
      const id = `demo-new-${this.nextId++}`
      const text = String(body.text || '') || L('(voice message)', '(Sprachnachricht)')
      const draft = !!body.draft
      const session: Session = {
        ...[...d.sessions.values()][0], id, title: String(body.title || '') || text.slice(0, 60), source: 'kanban', column: draft ? 'new' : 'doing', autoColumn: draft ? 'new' : 'doing',
        running: !draft, draft, activity: '', initialPrompt: text, createdAt: now(), updatedAt: now(), messageCount: 1, pending: [], paseo: [], override: false,
      }
      d.sessions.set(id, session)
      d.messages.set(id, [{ id: this.nextId++, role: 'user', ts: now(), text }])
      if (!draft) this.play(id)
      return reply(200, { session })
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1])
      const session = d.sessions.get(id)
      if (!session) return reply(404, { error: 'not found' })
      return reply(200, { session, messages: d.messages.get(id) ?? this.placeholder(session) })
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/))) {
      const id = decodeURIComponent(m[1])
      const list = d.messages.get(id) ?? []
      list.push({ id: this.nextId++, role: 'user', ts: now(), text: String(body.text || '') || L('(voice message)', '(Sprachnachricht)') })
      d.messages.set(id, list)
      this.play(id)
      return reply(200, { session: d.sessions.get(id), messages: list })
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/respond$/))) {
      const id = decodeURIComponent(m[1])
      const s = d.sessions.get(id)
      if (!s) return reply(404, { error: 'not found' })
      const prompt = s.pending.find((x) => x.promptId === body.promptId)
      this.update(id, { pending: s.pending.filter((x) => x.promptId !== body.promptId) })
      d.open = d.open.filter((o) => !(o.source === 'hermes' && o.prompt.promptId === body.promptId))
      if (prompt) d.items.unshift({ id: `demo-r-${this.nextId++}`, kind: prompt.kind, source: 'hermes', sessionId: id, title: s.title, text: prompt.command || prompt.question || '', at: now(), read: true, resolution: { at: now(), by: 'ui', choice: body.choice as string | undefined, answer: (body.answer as string) || (body.answers as string[] | undefined)?.join(', '), device: 'Demo' } })
      this.emitInbox()
      if (body.choice !== 'deny') this.play(id)
      return reply(200, { session: d.sessions.get(id) })
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/interrupt$/))) { this.finish(decodeURIComponent(m[1]), true); return reply(200, {}) }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/column$/))) {
      const id = decodeURIComponent(m[1])
      const col = body.column === 'auto' ? d.sessions.get(id)?.autoColumn : body.column
      return reply(200, { session: this.update(id, { column: col as Session['column'], override: body.column !== 'auto' }) })
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/paseo$/))) {
      const s = d.sessions.get(decodeURIComponent(m[1]))
      const ids = new Set((s?.paseo ?? []).map((c) => c.id))
      return reply(200, { connected: true, source: 'demo', agents: d.agents.filter((a) => ids.has(a.id)) })
    }
    if ((m = p.match(/^\/api\/paseo\/agents\/([^/]+)\/timeline$/))) {
      const agent = d.agents.find((a) => a.id === m![1])
      return reply(200, { agent, items: d.timelines.get(m[1]) ?? [{ role: 'assistant', ts: now() - 600, text: L('All checks passed.', 'Alle Prüfungen bestanden.') }], hasOlder: false })
    }
    if ((m = p.match(/^\/api\/paseo\/agents\/[^/]+\/permissions\/(.+)$/))) {
      d.open = d.open.filter((o) => !(o.source === 'paseo' && o.permission.id === decodeURIComponent(m![1])))
      this.emitInbox()
      return reply(200, {})
    }
    if (p === '/api/inbox') return reply(200, { open: d.open, items: d.items, unread: this.unread(), paseo: { connected: true, canRespond: true } })
    if (p === '/api/inbox/read') {
      const ids = body.ids as string[] | 'all'
      d.items = d.items.map((x) => (ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x))
      return reply(200, { unread: this.unread() })
    }
    if (p === '/api/search') {
      const q = (params.get('q') || '').toLowerCase()
      const all = [...d.sessions.values()]
      const title = all.filter((s) => s.title.toLowerCase().includes(q)).map((session) => ({ session }))
      const content = all.flatMap((session) => {
        const hit = (d.messages.get(session.id) ?? []).find((x) => x.text.toLowerCase().includes(q))
        if (!q || !hit) return []
        const i = hit.text.toLowerCase().indexOf(q)
        const snippet = `… ${hit.text.slice(Math.max(0, i - 40), i)}\u0002${hit.text.slice(i, i + q.length)}\u0003${hit.text.slice(i + q.length, i + q.length + 60)} …`
        return [{ session, hit: { msgId: hit.id ?? 0, role: hit.role, ts: hit.ts ?? 0, snippet, hits: 1 } }]
      })
      return reply(200, { q, title, content })
    }
    // Everything else (push registration, read markers, …) succeeds without effect.
    return reply(200, {})
  }

  // ---------- simulation ----------
  private emit(event: string, data: unknown) {
    const s = JSON.stringify(data)
    this.listeners.forEach((l) => l(event, s))
  }
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); fn() }, ms)
    this.timers.add(t)
  }
  private unread() { return this.data.items.filter((x) => !x.read).length }
  private emitInbox() { this.emit('inbox', { open: this.data.open, unread: this.unread() }) }
  private update(id: string, patch: Partial<Session>) {
    const s = this.data.sessions.get(id)
    if (!s) return null
    const next = { ...s, ...patch, updatedAt: now() }
    this.data.sessions.set(id, next)
    this.emit('session', next)
    return next
  }
  private placeholder(s: Session): ThreadMessage[] {
    const list: ThreadMessage[] = [
      { id: 1, role: 'user', ts: s.createdAt, text: s.initialPrompt || s.title },
      ...(s.draft ? [] : [{ id: 2, role: 'assistant' as const, ts: s.updatedAt, text: L('Done. The details are above; tell me if you want changes.', 'Erledigt. Die Details stehen oben; sag Bescheid, wenn du Änderungen willst.') }]),
    ]
    this.data.messages.set(s.id, list)
    return list
  }

  private playing = new Set<string>()
  /** Plays a reply: Doing, the text streamed word by word, then Waiting and a "done" inbox entry. */
  private play(id: string) {
    if (this.playing.has(id)) return
    this.playing.add(id)
    this.update(id, { running: true, column: 'doing', autoColumn: 'doing', override: false, draft: false, activity: L('Thinking …', 'Denkt nach …') })
    const words = REPLIES[0].split(/(?<=\s)/)
    let text = ''
    words.forEach((w, i) => this.later(700 + i * 45, () => {
      if (!this.playing.has(id)) return
      text += w
      this.emit('delta', { id, text: w })
    }))
    this.later(800 + words.length * 45, () => {
      if (!this.playing.has(id)) return
      const message: ThreadMessage = { id: this.nextId++, role: 'assistant', ts: now(), text }
      this.data.messages.set(id, [...(this.data.messages.get(id) ?? []), message])
      this.emit('message', { id, message })
      this.finish(id, false)
    })
  }
  private finish(id: string, stopped: boolean) {
    if (!this.playing.delete(id)) return
    this.emit('reload', { id, final: true })
    const s = this.update(id, { running: false, column: 'waiting', autoColumn: 'waiting', activity: stopped ? L('Stopped', 'Gestoppt') : L('💬 Done', '💬 Fertig') })
    const item: InboxItem = { id: `demo-done-${this.nextId++}`, kind: 'done', source: 'hermes', sessionId: id, title: s?.title ?? null, text: stopped ? L('Stopped', 'Gestoppt') : L('Reply ready', 'Antwort ist da'), at: now(), read: false }
    this.data.items.unshift(item)
    this.emit('inbox-item', item)
    this.emitInbox()
  }
}
