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
      className={cn(isWebDesktop ? 'min-h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground web:font-sans dark:bg-input/30' : 'min-h-12 rounded-lg border border-input bg-background px-3 text-base text-foreground', props.editable === false && 'opacity-50', className)}
      // Focus ring like the web UI's fields (CSS for data-hk-field in PlatformShell.web.tsx).
      {...({ dataSet: { hkField: '' } } as object)}
      {...props}
    />
  )
}
