import * as React from 'react'
import { TextInput } from 'react-native'
import { useColorScheme } from 'nativewind'
import { cn } from '@/lib/utils'
import { THEME } from '@/lib/theme'

export function Input({ className, ...props }: React.ComponentProps<typeof TextInput> & { className?: string }) {
  const { colorScheme } = useColorScheme()
  return (
    <TextInput
      placeholderTextColor={THEME[colorScheme === 'dark' ? 'dark' : 'light']['muted-foreground']}
      className={cn('min-h-12 rounded-lg border border-input bg-background px-3 text-base text-foreground', props.editable === false && 'opacity-50', className)}
      {...props}
    />
  )
}
