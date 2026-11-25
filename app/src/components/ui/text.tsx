// react-native-reusables pattern: parents (Button, Badge) set the text style for their children.
import * as React from 'react'
import { Text as RNText } from 'react-native'
import { cn } from '@/lib/utils'

export const TextClassContext = React.createContext<string | undefined>(undefined)
// Text inside Text is a span: it inherits size, colour and font from the outer text and only adds its own classes.
const NestedText = React.createContext(false)

export function Text({ className, children, ...props }: React.ComponentProps<typeof RNText> & { className?: string }) {
  const inherited = React.useContext(TextClassContext)
  const nested = React.useContext(NestedText)
  if (nested) return <RNText className={className} {...props}>{children}</RNText>
  // Geist on web / desktop, unless the text asks for monospace (a variant class would win over font-mono).
  const mono = className?.includes('font-mono')
  return (
    <RNText className={cn('text-base text-foreground', !mono && 'web:font-sans', inherited, className)} {...props}>
      <NestedText.Provider value>{children}</NestedText.Provider>
    </RNText>
  )
}
