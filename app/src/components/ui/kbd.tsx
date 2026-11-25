import { View } from 'react-native'
import { Text } from './text'
import { cn } from '@/lib/utils'

/** A key or shortcut, like the web UI's <Kbd>: 20 px tall, muted. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <View className={cn('h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1', className)}>
      <Text className="text-xs font-medium text-muted-foreground">{children}</Text>
    </View>
  )
}
