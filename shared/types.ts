export type Column = 'new' | 'doing' | 'waiting' | 'done'
export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'new', label: 'New Task' },
  { id: 'doing', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
]

export type PendingPrompt = {
  promptId: string
  kind: 'approval' | 'clarify'
  generation: number | null
  command: string | null
  description: string | null
  question: string | null
  choices: string[]
  multiSelect: boolean
  edit: unknown
  timeoutS: number | null
  at: number
}

export type AgentState = 'running' | 'idle' | 'closed' | 'error' | 'needs-attention' | 'finished' | 'archived' | 'unknown'
// provider 'hermes': an agent Hermes started itself (delegate_task subagent, kind 'subagent'; a terminal
// `hermes chat` run, kind 'terminal'; a terminal command in the background, kind 'process'). match says how it was tied to the chat: 'id' / 'goal' / 'order'
// (Hermes' own parent link) or 'prompt' / 'time' (terminal runs: a heuristic, shown as such).
export type AgentProvider = 'paseo' | 'hermes'
export type AgentMatch = 'id' | 'goal' | 'order' | 'prompt' | 'time' | null
// How a Paseo agent is tied to the chat besides its transcript (server/src/agent-links.mjs): a label naming the
// session, the successor of a linked agent (labels.predecessor), or attached by hand. Absent = transcript.
export type AgentVia = 'label' | 'successor' | 'manual'
export type PaseoChip = { id: string; title: string | null; state: AgentState; status: string; rel: 'created' | 'steers' | 'watches'; account: string | null; kind: string | null; archived: boolean; pendingCount: number; createdAt?: string | null; updatedAt?: string | null; provider?: AgentProvider; match?: AgentMatch; via?: AgentVia; successorOf?: string | null; predecessorTitle?: string | null }
export type PaseoAgent = PaseoChip & {
  known: boolean
  pendingPermissions?: { kind: string; name: string; title: string | null }[]
  attentionReason?: string | null
  lastError?: string | null
  goal?: string | null
  phase?: string | null
  model?: string | null
  cwd?: string | null
  updatedAt?: string | null
  createdAt?: string | null
  deepLink?: string | null
  // provider 'hermes'
  profile?: string | null
  sessionId?: string | null
  command?: string | null
}
export type PaseoItem = {
  role: 'user' | 'assistant' | 'tool' | 'todo' | 'error' | 'notice'
  text?: string
  ts: number
  toolName?: string
  status?: string
  summary?: string
  level?: string
  images?: string[]
  todos?: { text: string; done: boolean }[]
}

export type Session = {
  id: string
  title: string
  source: string
  system: boolean
  column: Column
  autoColumn: Column
  override: boolean
  running: boolean
  draft?: boolean
  activity: string
  initialPrompt: string
  createdAt: number
  updatedAt: number
  messageCount: number
  test: boolean
  pending: PendingPrompt[]
  paseo: PaseoChip[]
  paseoNote: string
}

// A local file the backend confirmed for this chat (exists, allowed, not on the denylist; see
// docs/security.md "Files in chats"). `key` is the path as the message wrote it (shared/file-refs.ts),
// `url` serves it (preview; `&download=1` as attachment), `text` its first MB as JSON for text previews.
export type FileInfo = { key: string; path: string; name: string; size: number; mtime: number; mime: string; url: string; preview: boolean }

export type Attachment = { kind: 'image'; url: string } | { kind: 'audio'; url: string } | { kind: 'file'; name: string; file?: FileInfo }

// Sent while Hermes works, not in the transcript yet: sending → queued (Hermes' FIFO, next turn) → started →
// gone once it is in the transcript; lost / failed → send again. id null = queued from another client.
export type OutboxState = { id: string | null; status: 'sending' | 'waiting' | 'queued' | 'started' | 'lost' | 'failed'; mode?: string; error?: string }

export type ThreadMessage = {
  id?: number
  // Row key when one transcript row yields several items (a delegate_task call starting several subagents).
  key?: string
  // event: delivered to the session but not typed by the user (webhook, cron, background notices)
  role: 'user' | 'assistant' | 'tool' | 'system' | 'event' | 'paseo'
  text: string
  ts?: number
  toolName?: string
  summary?: string
  live?: boolean
  attachments?: Attachment[]
  /** Local files this message mentions that may be opened (file chips in the text, tool output). */
  files?: FileInfo[]
  event?: { source: string; route?: string; title: string }
  meta?: { kind: 'reply' | 'origin'; text: string }[]
  steer?: boolean
  threadContext?: string
  outbox?: OutboxState
  // Paseo tool call at this point of the chat; live state comes from the session's paseo chips.
  paseo?: { action: 'create' | 'message' | 'archive' | 'permission'; ref: string; agentId: string | null; title?: string | null; account?: string | null; text?: string; provider?: AgentProvider; kind?: string | null }
}

export type RemoteState = {
  mode: string
  status: 'off' | 'starting' | 'online' | 'reconnecting' | 'needs-login' | 'needs-approval' | 'error'
  url: string | null
  loginUrl: string | null
  error: string | null
  endpointId?: string | null
  relayUrl?: string | null
  uiUrl?: string | null
  connections?: number
}

export type Device = { id: string; name: string; via: string; remote: boolean; irohId?: string | null; createdAt: number; lastSeen: number; expiresAt: number }

export type Upload = { name?: string; type: string; data: string }
export type OutgoingMessage = { text: string; title?: string; test?: boolean; draft?: boolean; images: Upload[]; audio: Upload | null }

export type Tab = 'board' | 'inbox'

export type PaseoPermission = {
  id: string
  kind: string
  name: string
  title: string | null
  description: string | null
  command: string | null
  actions: { id: string; label: string; behavior: 'allow' | 'deny' }[] | null
}

/** Something that needs the user now (derived live by the backend). */
export type OpenItem =
  | { key: string; source: 'hermes'; kind: 'approval' | 'clarify'; sessionId: string; title: string; at: number; prompt: PendingPrompt }
  | {
      key: string; source: 'paseo'; kind: 'permission'; sessionId: string | null; title: string | null; at: number
      agent: { id: string; title: string | null; account: string | null; cwd: string | null; deepLink: string | null }
      permission: PaseoPermission
      canRespond: boolean
    }

export type InboxKind = 'approval' | 'clarify' | 'permission' | 'done' | 'error' | 'paseo-done' | 'paseo-error' | 'paseo-limit' | 'automation'

/** Where an inbox entry comes from: chats, agents, or automations (cron runs, webhook runs, `POST /api/notify`). */
export type InboxSource = 'hermes' | 'paseo' | 'cron' | 'webhook' | 'notify'
export const AUTOMATION_SOURCES: readonly InboxSource[] = ['cron', 'webhook', 'notify']

/** One entry of the inbox history (backend data/inbox.json). */
export type InboxItem = {
  id: string
  kind: InboxKind
  source: InboxSource
  sessionId: string | null
  title: string | null
  text: string
  at: number
  read: boolean
  agentId?: string
  agentTitle?: string
  resolution?: { at: number; by: 'ui' | 'elsewhere' | 'cancelled' | 'expired'; choice?: string; answer?: string; decision?: string; device?: string }
  // Automations (kind 'automation', source cron | webhook | notify):
  /** Job name (cron), route name (webhook) or the caller's group (notify); the inbox groups by it. */
  group?: string
  /** ok = a run that reported something (or notify info/warn); error = a failed or blocked run, notify level error. */
  status?: 'ok' | 'error'
  /** notify only: the level the caller sent. */
  level?: 'info' | 'warn' | 'error'
  /** The full report as Markdown (bounded), shown when the entry is expanded. `text` is the one-line preview. */
  body?: string
  /** notify only: a link the caller attached (http/https). */
  link?: string
  /** cron only: the Hermes job id. */
  jobId?: string
  /** The same error again (same group, same text): folded into this entry instead of a new one. */
  repeat?: number
}

export type PushSettings = {
  approval: boolean
  done: boolean
  error: boolean
  paseo: boolean
  /** Automations that reported something (cron, webhook). */
  automations: boolean
  /** Automations that failed or were blocked. */
  automationErrors: boolean
  /** Messages sent with `POST /api/notify` / `hermes-ui notify` (level error counts as automationErrors). */
  notify: boolean
  skipWhenVisible: boolean
  quiet: { enabled: boolean; from: string; to: string }
  tz: string | null
}
