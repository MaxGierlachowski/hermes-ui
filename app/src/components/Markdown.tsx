import { memo, type ReactNode } from 'react'
import { Linking, Platform, ScrollView, Text, View, type TextStyle } from 'react-native'
import { useColorScheme } from 'nativewind'
import { Renderer, useMarkdown, type useMarkdownHookOptions } from 'react-native-marked'
import { THEME } from '@/lib/theme'
import { isWebDesktop } from '@/lib/web-input'
import { CodeBlock } from './CodeBlock'

// Type scale: the web UI's `prose-sm` on the desktop (14 / 24 px), a size up on phones.
const SANS = Platform.OS === 'web' ? { fontFamily: '"Geist Variable", -apple-system, BlinkMacSystemFont, sans-serif' } : {}
const BODY = isWebDesktop ? { fontSize: 14, lineHeight: 24, ...SANS } : { fontSize: 15, lineHeight: 22, ...SANS }
// (SANS: Geist on web and desktop, like Text's web:font-sans.)
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' })

type Colors = (typeof THEME)['light'] | (typeof THEME)['dark']

// Code blocks with highlighting, inline code as a quiet chip, links that open outside, tables like the web.
class HermesRenderer extends Renderer {
  constructor(private c: Colors) { super() }
  private k = 0
  private key() { return `hk-md-${this.k++}` }
  code(text: string, language?: string): ReactNode {
    return <CodeBlock key={this.key()} code={text} language={language} />
  }
  codespan(text: string, styles?: TextStyle): ReactNode {
    const web = Platform.OS === 'web'
    // A span on the web can have padding and a border; native inline text cannot.
    return (
      <Text key={this.key()} selectable style={[styles, web && { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: this.c.border }]}>
        {text}
      </Text>
    )
  }
  link(children: string | ReactNode[], href: string, styles?: TextStyle): ReactNode {
    return (
      <Text key={this.key()} accessibilityRole="link" style={styles} onPress={() => { Linking.openURL(href).catch(() => {}) }}
        {...(Platform.OS === 'web' ? ({ href, hrefAttrs: { target: '_blank', rel: 'noreferrer noopener' } } as object) : {})}>
        {children}
      </Text>
    )
  }
  table(header: ReactNode[][], rows: ReactNode[][][]): ReactNode {
    const c = this.c
    const cell = (content: ReactNode[], i: number, head: boolean) => (
      <View key={i} style={{ flex: 1, minWidth: 96, paddingVertical: 6, paddingHorizontal: 8 }}>
        {head ? <Text style={{ ...BODY, fontWeight: '600', color: c.foreground }}>{content}</Text> : content}
      </View>
    )
    const table = (
      <View style={{ minWidth: '100%' }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.border }}>{header.map((h, i) => cell(h, i, true))}</View>
        {rows.map((r, j) => (
          <View key={j} style={{ flexDirection: 'row', borderBottomWidth: j < rows.length - 1 ? 1 : 0, borderColor: c.border }}>{r.map((x, i) => cell(x, i, false))}</View>
        ))}
      </View>
    )
    return (
      <ScrollView key={this.key()} horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ flexGrow: 1 }}>
        {table}
      </ScrollView>
    )
  }
}

// One options object per colour scheme. useMarkdown memoizes styles, parser and tokens on the identity
// of these objects; building them inline re-parsed every message on every render of the thread.
const options = (dark: boolean): useMarkdownHookOptions => {
  const c = THEME[dark ? 'dark' : 'light']
  return {
    colorScheme: dark ? 'dark' : 'light',
    renderer: new HermesRenderer(c),
    theme: { colors: { text: c.foreground, link: c.primary, code: c.muted, border: c.border } },
    styles: {
      text: { ...BODY, color: c.foreground },
      paragraph: { marginVertical: isWebDesktop ? 6 : 3, paddingVertical: 0 },
      strong: { fontWeight: '600' },
      link: { color: c.primary, textDecorationLine: 'underline', textDecorationColor: `${c.primary}66` } as TextStyle,
      codespan: { fontFamily: MONO, fontStyle: 'normal', fontSize: BODY.fontSize * 0.88, backgroundColor: c.muted, color: c.foreground },
      h1: { fontSize: isWebDesktop ? 22 : 20, lineHeight: isWebDesktop ? 30 : 26, fontWeight: '700', color: c.foreground, marginTop: 10, marginBottom: 6 },
      h2: { fontSize: isWebDesktop ? 18 : 18, lineHeight: isWebDesktop ? 26 : 24, fontWeight: '700', color: c.foreground, marginTop: 10, marginBottom: 4 },
      h3: { fontSize: isWebDesktop ? 15 : 16, lineHeight: 22, fontWeight: '600', color: c.foreground, marginTop: 8, marginBottom: 4 },
      blockquote: { borderLeftColor: c.border, borderLeftWidth: 3, paddingLeft: 12, marginVertical: 6 },
      li: { ...BODY, color: c.foreground },
      hr: { borderBottomWidth: 1, borderColor: c.border, marginVertical: 12 },
    },
  }
}
const OPTIONS = { light: options(false), dark: options(true) }

/** Hermes' replies (GFM) as native text: selectable, theme colours, highlighted code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const { colorScheme } = useColorScheme()
  const elements = useMarkdown(text, OPTIONS[colorScheme === 'dark' ? 'dark' : 'light'])
  return <View>{elements.map((el, i) => <View key={i}>{el}</View>)}</View>
})
