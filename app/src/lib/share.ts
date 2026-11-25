// Hand-over from "Share → Hermes UI" to the new-chat screen.
export type SharedDraft = { text: string; imageUri: string | null; mimeType?: string }
let draft: SharedDraft | null = null
export const setSharedDraft = (d: SharedDraft) => { draft = d }
export const takeSharedDraft = () => { const d = draft; draft = null; return d }
