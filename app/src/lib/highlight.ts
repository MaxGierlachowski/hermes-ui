// Prism and its grammars, loaded on demand by CodeBlock (dynamic import: ~38 KB gzip out of the start bundle).
import { Prism, normalizeTokens } from 'prism-react-renderer'

// prism-react-renderer bundles the common languages; shell and diff are what agents print most besides.
;(globalThis as { Prism?: unknown }).Prism = Prism
require('prismjs/components/prism-bash')
require('prismjs/components/prism-diff')

const ALIAS: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellsession: 'bash', ts: 'typescript', js: 'javascript', py: 'python', yml: 'yaml', patch: 'diff', html: 'markup', xml: 'markup' }

export function tokenize(text: string, language?: string) {
  const lang = ALIAS[language?.toLowerCase() ?? ''] ?? language?.toLowerCase() ?? ''
  const grammar = lang ? Prism.languages[lang] : undefined
  if (!grammar) return null
  try { return normalizeTokens(Prism.tokenize(text, grammar)) } catch { return null }
}
