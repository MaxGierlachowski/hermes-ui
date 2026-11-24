// Local files a chat mentions: absolute or ~/ paths and file:// URLs in prose, in inline code that is
// nothing but a path, and as the target of Markdown links. The backend resolves what this finds and
// sends back only files that exist and may be shown (server/src/file-access.mjs); the app turns exactly
// those into file chips. MEDIA:<path> tags are attachments, not references (shared/media-tags.ts).
//
// Never inside fenced code blocks, blockquotes stay normal text. A bare path in prose needs a file
// extension (so "/api/sessions" or "and/or" stay text); inline code and links may name any file.

export type FileRefVia = 'link' | 'code' | 'url' | 'path'

export type FileRefSpan = {
  /** Offsets in the original text; the whole link / code span / path. */
  start: number
  end: number
  /** The path as written, normalised: file:// decoded, :line suffix and trailing punctuation removed, ~/ kept. */
  key: string
  /** A Markdown link's own text, else empty. */
  label: string
  via: FileRefVia
}

const MAX_REFS = 50

const FENCED_RE = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*(?=\n|$)|$)/gm
const MEDIA_RE = /MEDIA:\s*\S[^\n]*/g
const URL_RE = /\b(?:https?|ftp|wss?):\/\/[^\s<>]+/g
// [label](target) with a local target: <…> (may hold spaces) or a run without spaces / closing paren.
const LINK_RE = /\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:file:\/\/|~\/|\/)[^\s)]*))(?:\s+"[^"\n]*")?\s*\)/g
const CODE_RE = /(`+)([^`\n]+?)\1/g
const FILE_URL_RE = /file:\/\/[^\s<>()[\]"'`]+/g
// A path in prose: starts the text or follows space / an opening bracket or quote; ~/ or / (not //).
const BARE_RE = /(?<=^|[\s([{"'“‘«])(?:~\/|\/(?!\/))[\p{L}\p{N}_@%+\-.~]+(?:\/[\p{L}\p{N}_@%+\-.~]+)*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?::\d+)?)?(?=$|[\s)\]}"'”’»,;:!?]|\.(?:\s|$))/gmu
// Shell-ish characters: inline code with these is a command or a pattern, not a file name.
const NOT_A_PATH = /[*?|<>"$;=&{}`\\]|\s-{1,2}\w|\s\//

const LINE_SUFFIX = /:\d+(?::\d+)?$/

/** Normalised key of a written path, or null if it is not a plausible absolute file path. */
export function fileKey(raw: string): string | null {
  let p = String(raw || '').trim()
  if (/^file:/i.test(p)) {
    const m = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(p)
    if (!m) return null
    try { p = decodeURIComponent(m[1]) } catch { return null }
  } else if (/%[0-9a-f]{2}/i.test(p)) {
    try { p = decodeURIComponent(p) } catch { /* keep as written */ }
  }
  p = p.replace(LINE_SUFFIX, '').replace(/[.,;:!?]+$/, '')
  if (!(p.startsWith('/') || p.startsWith('~/')) || p.startsWith('//')) return null
  if (p.endsWith('/') || p.includes('\0') || p.length > 1024) return null
  const segs = p.split('/').filter(Boolean)
  // "/x" alone is a root entry or a route, never a file someone produced.
  if (p.startsWith('/') && segs.length < 2) return null
  if (segs.some((s) => s === '..' || s === '.')) return null
  return p
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** Blank the given spans (same length, newlines kept), so later patterns do not see their content. */
function blank(text: string, spans: [number, number][]) {
  let out = text
  for (const [s, e] of spans) out = out.slice(0, s) + out.slice(s, e).replace(/[^\n]/g, ' ') + out.slice(e)
  return out
}

/** File references in a message, in text order (at most 50, one span per occurrence). */
export function findFileRefs(text: string): FileRefSpan[] {
  const src = String(text ?? '')
  if (!/[/~]/.test(src)) return []
  const found: FileRefSpan[] = []
  let masked = blank(src, [...src.matchAll(FENCED_RE)].map((m) => [m.index!, m.index! + m[0].length]))
  masked = blank(masked, [...masked.matchAll(MEDIA_RE)].map((m) => [m.index!, m.index! + m[0].length]))

  const taken: [number, number][] = []
  for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index!
    const end = start + m[0].length
    taken.push([start, end])
    const key = fileKey(m[2] ?? m[3] ?? '')
    if (key) found.push({ start, end, key, label: src.slice(start + 1, start + 1 + m[1].length).trim(), via: 'link' })
  }
  masked = blank(masked, taken)
  taken.length = 0

  for (const m of masked.matchAll(CODE_RE)) {
    const start = m.index!
    const end = start + m[0].length
    taken.push([start, end])
    const inner = m[2].trim()
    if (NOT_A_PATH.test(inner)) continue
    const key = fileKey(inner)
    if (key) found.push({ start, end, key, label: '', via: 'code' })
  }
  masked = blank(masked, taken)
  masked = blank(masked, [...masked.matchAll(URL_RE)].map((m) => [m.index!, m.index! + m[0].length]))
  taken.length = 0

  for (const m of masked.matchAll(FILE_URL_RE)) {
    const start = m.index!
    const raw = m[0].replace(/[.,;:!?]+$/, '')
    taken.push([start, start + raw.length])
    const key = fileKey(raw)
    if (key) found.push({ start, end: start + raw.length, key, label: '', via: 'url' })
  }
  masked = blank(masked, taken)

  for (const m of masked.matchAll(BARE_RE)) {
    const start = m.index!
    // A path glued to a word ("and/or.txt") or part of a longer token is no reference.
    const key = fileKey(m[0])
    if (key) found.push({ start, end: start + m[0].length, key, label: '', via: 'path' })
  }
  return found.sort((a, b) => a.start - b.start).slice(0, MAX_REFS)
}

/** Unique keys of all references, in order. */
export function fileRefKeys(text: string): string[] {
  return [...new Set(findFileRefs(text).map((r) => r.key))]
}

/** The prefix of the links linkFileRefs writes; the Markdown renderer turns them into file chips. */
export const FILE_LINK_SCHEME = 'hermesfile:'

const escapeLabel = (s: string) => s.replace(/([\\[\]*_`<>])/g, '\\$1')

/**
 * Markdown with every confirmed reference replaced by a link `[name](hermesfile:<index>)` (letters only: react-native-marked treats `[a-z]+:` as a scheme), index into
 * `keys`; references the backend did not confirm stay as written.
 */
export function linkFileRefs(text: string, keys: string[]): string {
  if (!keys.length) return text
  const index = new Map(keys.map((k, i) => [k, i]))
  let out = ''
  let at = 0
  for (const r of findFileRefs(text)) {
    const i = index.get(r.key)
    if (i === undefined || r.start < at) continue
    out += text.slice(at, r.start) + `[${escapeLabel(r.label || basename(r.key))}](${FILE_LINK_SCHEME}${i})`
    at = r.end
  }
  return out + text.slice(at)
}

// ---------- what a preview can show ----------

export type FilePreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'markdown' | 'csv' | 'text' | 'other'

const EXT_KIND: Record<string, FilePreviewKind> = {}
const kinds: [FilePreviewKind, string][] = [
  ['image', 'png jpg jpeg gif webp avif'],
  ['audio', 'mp3 m4a wav ogg opus flac'],
  ['video', 'mp4 webm mov'],
  ['pdf', 'pdf'],
  ['markdown', 'md markdown mdx'],
  ['csv', 'csv tsv'],
  // Text, shown as source with highlighting where the language is known. HTML and SVG are text here:
  // never rendered.
  ['text', 'txt log text ini cfg conf toml yaml yml json jsonl json5 xml plist html htm svg css scss less js mjs cjs jsx ts mts cts tsx py rb go rs java kt kts swift c h cc cpp hpp m mm cs php pl lua r sql sh bash zsh fish ps1 bat dockerfile makefile gradle properties diff patch tex bib vue svelte astro graphql gql proto lock gitignore editorconfig'],
]
for (const [kind, exts] of kinds) for (const e of exts.split(' ')) EXT_KIND[e] = kind

export const extOf = (name: string) => {
  const b = basename(name).toLowerCase()
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1) : b === 'dockerfile' || b === 'makefile' ? b : ''
}

/** How a file is previewed, from its name. */
export function previewKind(name: string): FilePreviewKind {
  return EXT_KIND[extOf(name)] ?? 'other'
}

const LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', lua: 'lua', r: 'r', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell',
  json: 'json', jsonl: 'json', json5: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'markup', plist: 'markup', html: 'markup', htm: 'markup', svg: 'markup',
  css: 'css', scss: 'scss', less: 'less', diff: 'diff', patch: 'diff', graphql: 'graphql', gql: 'graphql', dockerfile: 'docker', ini: 'ini', md: 'markdown',
}

/** Highlighting language (Prism name) for a file name, if known. */
export const codeLanguage = (name: string): string | undefined => LANG[extOf(name)]

/** Simple CSV / TSV → rows (quotes and doubled quotes; at most `maxRows`). Null if it does not look tabular. */
export function parseCsv(text: string, { tab = false, maxRows = 500 } = {}): { rows: string[][]; more: boolean } | null {
  const sep = tab ? '\t' : text.slice(0, 2000).split('\n')[0].split(';').length > text.slice(0, 2000).split('\n')[0].split(',').length ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
      if (rows.length >= maxRows) break
    } else cell += ch
  }
  if (rows.length < maxRows && (cell || row.length)) { row.push(cell); rows.push(row) }
  if (!rows.length) return null
  const width = rows[0].length
  if (width < 2 || rows.some((r) => r.length !== width && !(r.length === 1 && r[0] === ''))) return null
  return { rows: rows.filter((r) => !(r.length === 1 && r[0] === '')), more: i < text.length - 1 }
}

/** 1536 → "1.5 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`
}
