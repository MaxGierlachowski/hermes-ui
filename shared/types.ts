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
export type PaseoChip = { id: string; title: string | null; state: AgentState; status: string; rel: 'created' | 'steers' | 'watches'; account: string | null; kind: string | null; archived: boolean; pendingCount: number; createdAt?: string | null; updatedAt?: string | null }
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

export type Attachment = { kind: 'image'; url: string } | { kind: 'audio'; url: string } | { kind: 'file'; name: string }

// Sent while Hermes works, not in the transcript yet: sending → queued (Hermes' FIFO, next turn) → started →
// gone once it is in the transcript; lost / failed → send again. id null = queued from another client.
export type OutboxState = { id: string | null; status: 'sending' | 'waiting' | 'queued' | 'started' | 'lost' | 'failed'; mode?: string; error?: string }

export type ThreadMessage = {
  id?: number
  // event: delivered to the session but not typed by the user (webhook, cron, background notices)
  role: 'user' | 'assistant' | 'tool' | 'system' | 'event' | 'paseo'
  text: string
  ts?: number
  toolName?: string
  summary?: string
  live?: boolean
  attachments?: Attachment[]
  event?: { source: string; route?: string; title: string }
  meta?: { kind: 'reply' | 'origin'; text: string }[]
  steer?: boolean
  threadContext?: string
  outbox?: OutboxState
  // Paseo tool call at this point of the chat; live state comes from the session's paseo chips.
  paseo?: { action: 'create' | 'message' | 'archive' | 'permission'; ref: string; agentId: string | null; title?: string | null; account?: string | null; text?: string }
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
/** `model` + `provider` (both or neither) pin a NEW chat's model; omitted, the gateway's default applies. */
export type OutgoingMessage = { text: string; title?: string; test?: boolean; draft?: boolean; model?: string; provider?: string; images: Upload[]; audio: Upload | null }

/** GET /api/models: what the "new chat" picker offers (Hermes' `model.options`, usable providers only). */
export type ModelChoice = { model: string; provider: string }
export type ModelOptions = { current: { model: string; provider: string | null } | null; providers: { slug: string; name: string; models: string[] }[] }

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

export type InboxKind = 'approval' | 'clarify' | 'permission' | 'done' | 'error' | 'paseo-done' | 'paseo-error' | 'paseo-limit'

/** One entry of the inbox history (backend data/inbox.json). */
export type InboxItem = {
  id: string
  kind: InboxKind
  source: 'hermes' | 'paseo'
  sessionId: string | null
  title: string | null
  text: string
  at: number
  read: boolean
  agentId?: string
  agentTitle?: string
  resolution?: { at: number; by: 'ui' | 'elsewhere' | 'cancelled' | 'expired'; choice?: string; answer?: string; decision?: string; device?: string }
}

export type PushSettings = {
  approval: boolean
  done: boolean
  error: boolean
  paseo: boolean
  skipWhenVisible: boolean
  quiet: { enabled: boolean; from: string; to: string }
  tz: string | null
}
