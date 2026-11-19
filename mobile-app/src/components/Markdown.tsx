import { memo } from 'react'
import { View } from 'react-native'
import { useColorScheme } from 'nativewind'
import { useMarkdown } from 'react-native-marked'
import { THEME } from '@/lib/theme'

/** Hermes' replies (GFM) as native text: selectable, theme colours, mono code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const c = THEME[dark ? 'dark' : 'light']
  const elements = useMarkdown(text, {
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
  })
  return <View>{elements.map((el, i) => <View key={i}>{el}</View>)}</View>
})
