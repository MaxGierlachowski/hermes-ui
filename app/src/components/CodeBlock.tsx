// Code blocks with syntax highlighting, like the web UI's shiki blocks (github-light / github-dark):
// Prism tokens as nested Text, so it works the same on phone, web and desktop and stays selectable.
import { memo, useEffect, useMemo, useState } from 'react'
import { Platform, ScrollView, Text, View } from 'react-native'
import { useColorScheme } from 'nativewind'
import { THEME } from '@/lib/theme'
import { isWebDesktop } from '@/lib/web-input'

// The highlighter is not in the start bundle: it loads with the first code block, or when the app is idle.
// Until then a block shows its plain text in the same box.
type Highlighter = typeof import('@/lib/highlight')
let highlighter: Highlighter | null = null
let loading: Promise<Highlighter> | null = null
const loadHighlighter = () => (loading ??= import('@/lib/highlight').then((m) => (highlighter = m)))
setTimeout(() => { loadHighlighter().catch(() => {}) }, 3000)

// GitHub's light and dark code colours (the shiki themes of the web UI), by Prism token type.
const COLORS = {
  light: { plain: '#24292e', comment: '#6a737d', keyword: '#d73a49', string: '#032f62', number: '#005cc5', function: '#6f42c1', tag: '#22863a', attr: '#6f42c1', inserted: '#22863a', deleted: '#b31d28' },
  dark: { plain: '#e1e4e8', comment: '#6a737d', keyword: '#f97583', string: '#9ecbff', number: '#79b8ff', function: '#b392f0', tag: '#85e89d', attr: '#b392f0', inserted: '#85e89d', deleted: '#fdaeb7' },
}
type Palette = (typeof COLORS)['light']
const TYPE_COLOR: Record<string, keyof Palette> = {
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment', shebang: 'comment',
  keyword: 'keyword', operator: 'keyword', important: 'keyword', atrule: 'keyword', rule: 'keyword', selector: 'tag',
  string: 'string', char: 'string', regex: 'string', url: 'string', 'attr-value': 'string', 'template-string': 'string',
  number: 'number', boolean: 'number', constant: 'number', symbol: 'number', property: 'number', builtin: 'number', variable: 'number', entity: 'number',
  function: 'function', 'class-name': 'function', 'maybe-class-name': 'function', parameter: 'plain',
  tag: 'tag', 'attr-name': 'attr', namespace: 'attr',
  inserted: 'inserted', deleted: 'deleted', punctuation: 'plain',
}
const colorOf = (types: string[], p: Palette) => {
  for (let i = types.length - 1; i >= 0; i--) { const k = TYPE_COLOR[types[i]]; if (k) return p[k] }
  return p.plain
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' })

export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const p = COLORS[dark ? 'dark' : 'light']
  const c = THEME[dark ? 'dark' : 'light']
  const text = code.replace(/\n$/, '')
  const [hl, setHl] = useState(highlighter)
  useEffect(() => { if (!hl) loadHighlighter().then(setHl, () => {}) }, [hl])
  const lines = useMemo(() => (hl ? hl.tokenize(text, language) : null), [hl, text, language])
  const body = (
    <Text selectable style={{ fontFamily: MONO, fontSize: isWebDesktop ? 13 : 12.5, lineHeight: isWebDesktop ? 20 : 18, color: p.plain }}>
      {lines
        ? lines.map((line, i) => (
          <Text key={i}>
            {line.map((tok, j) => (tok.empty ? null : <Text key={j} style={{ color: colorOf(tok.types, p) }}>{tok.content}</Text>))}
            {i < lines.length - 1 ? '\n' : null}
          </Text>
        ))
        : text}
    </Text>
  )
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 12, marginVertical: 8, overflow: 'hidden' }}>
      {/* Web wraps long lines like the web UI (pre-wrap); phones scroll sideways. */}
      {Platform.OS === 'web'
        ? <View style={{ padding: 16 }}>{body}</View>
        : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>{body}</ScrollView>}
    </View>
  )
})
