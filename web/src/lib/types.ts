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
export type PaseoChip = { id: string; title: string | null; state: AgentState; status: string; rel: 'created' | 'steers' | 'watches'; account: string | null; kind: string | null; archived: boolean; pendingCount: number }
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

export type ThreadMessage = {
  id?: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  ts?: number
  toolName?: string
  summary?: string
  live?: boolean
  attachments?: Attachment[]
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
