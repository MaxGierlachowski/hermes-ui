import { Pressable, View } from 'react-native'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { shadow } from '@/lib/shadow'

/** The web UI's switch (shadcn): 32 × 18 track, primary when on. */
export function Switch({ value, onValueChange, accessibilityLabel, disabled }: { value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      onPress={() => { haptic('select'); onValueChange(!value) }}
      className={cn('h-[18px] w-8 justify-center rounded-full px-0.5 web:transition-colors', value ? 'bg-primary' : 'bg-input dark:bg-input/80', disabled && 'opacity-50')}
    >
      <View className={cn('h-[14px] w-[14px] rounded-full bg-background web:transition-transform', value && 'translate-x-[14px] dark:bg-primary-foreground')} style={shadow('sm')} />
    </Pressable>
  )
}
