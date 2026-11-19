import * as React from 'react'
import { TextInput } from 'react-native'
import { useColorScheme } from 'nativewind'
import { cn } from '@/lib/utils'
import { THEME } from '@/lib/theme'
import { isWebDesktop } from '@/lib/web-input'

export function Input({ className, ...props }: React.ComponentProps<typeof TextInput> & { className?: string }) {
  const { colorScheme } = useColorScheme()
  return (
    <TextInput
      placeholderTextColor={THEME[colorScheme === 'dark' ? 'dark' : 'light']['muted-foreground']}
      className={cn(isWebDesktop ? 'min-h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground' : 'min-h-12 rounded-lg border border-input bg-background px-3 text-base text-foreground', props.editable === false && 'opacity-50', className)}
      {...props}
    />
  )
}
