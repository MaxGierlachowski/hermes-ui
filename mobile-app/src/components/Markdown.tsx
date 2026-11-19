import { memo } from 'react'
import { View } from 'react-native'
import { useColorScheme } from 'nativewind'
import { useMarkdown, type useMarkdownHookOptions } from 'react-native-marked'
import { THEME } from '@/lib/theme'

// One options object per colour scheme. useMarkdown memoizes styles, parser and tokens on the identity
// of these objects; building them inline re-parsed every message on every render of the thread.
const options = (dark: boolean): useMarkdownHookOptions => {
  const c = THEME[dark ? 'dark' : 'light']
  return {
    colorScheme: dark ? 'dark' : 'light',
    theme: { colors: { text: c.foreground, link: c.primary, code: c.muted, border: c.border } },
    styles: {
      text: { fontSize: 15, lineHeight: 22, color: c.foreground },
      paragraph: { marginVertical: 3, paddingVertical: 0 },
      codespan: { fontFamily: 'monospace', fontSize: 13.5, backgroundColor: c.muted, color: c.foreground },
      code: { backgroundColor: c.muted, borderRadius: 8, padding: 10, marginVertical: 6 },
      codeText: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 18, color: c.foreground },
      h1: { fontSize: 20, fontWeight: '700', color: c.foreground, marginVertical: 6 },
      h2: { fontSize: 18, fontWeight: '700', color: c.foreground, marginVertical: 5 },
      h3: { fontSize: 16, fontWeight: '600', color: c.foreground, marginVertical: 4 },
      blockquote: { borderLeftColor: c.border, borderLeftWidth: 3, paddingLeft: 10, marginVertical: 4 },
      li: { fontSize: 15, lineHeight: 22, color: c.foreground },
    },
  }
}
const OPTIONS = { light: options(false), dark: options(true) }

/** Hermes' replies (GFM) as native text: selectable, theme colours, mono code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const { colorScheme } = useColorScheme()
  const elements = useMarkdown(text, OPTIONS[colorScheme === 'dark' ? 'dark' : 'light'])
  return <View>{elements.map((el, i) => <View key={i}>{el}</View>)}</View>
})
