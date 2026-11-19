// react-native-reusables pattern: parents (Button, Badge) set the text style for their children.
import * as React from 'react'
import { Text as RNText } from 'react-native'
import { cn } from '@/lib/utils'

export const TextClassContext = React.createContext<string | undefined>(undefined)

export function Text({ className, ...props }: React.ComponentProps<typeof RNText> & { className?: string }) {
  const inherited = React.useContext(TextClassContext)
  return <RNText className={cn('text-base text-foreground', inherited, className)} {...props} />
}
