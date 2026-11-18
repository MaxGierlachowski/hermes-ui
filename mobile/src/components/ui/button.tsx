import * as React from 'react'
import { Pressable } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { TextClassContext } from './text'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'

// Touch targets: at least 48 dp tall (default/lg) or an icon button of 48 × 48.
const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-lg active:opacity-80', {
  variants: {
    variant: {
      default: 'bg-primary',
      destructive: 'bg-destructive',
      outline: 'border border-border bg-background active:bg-accent',
      secondary: 'bg-secondary',
      ghost: 'active:bg-accent',
    },
    size: {
      default: 'h-12 px-4',
      sm: 'h-10 px-3',
      lg: 'h-14 px-6',
      icon: 'h-12 w-12',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

const buttonTextVariants = cva('text-[15px] font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-white',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

type Props = React.ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants> & { className?: string; haptics?: boolean }

export function Button({ className, variant, size, haptics = true, onPress, disabled, ...props }: Props) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant })}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        className={cn(buttonVariants({ variant, size }), disabled && 'opacity-50', className)}
        onPress={(e) => { if (haptics) haptic(); onPress?.(e) }}
        {...props}
      />
    </TextClassContext.Provider>
  )
}
