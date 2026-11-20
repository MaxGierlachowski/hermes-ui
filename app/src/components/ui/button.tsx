import * as React from 'react'
import { Pressable } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { TextClassContext } from './text'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { isWebDesktop } from '@/lib/web-input'

// The web UI's shadcn button. With a mouse or trackpad (web / desktop, pointer: fine) its desktop sizes
// (32 px, sm 28, lg 36, icon 32); on touch screens touch targets of at least 48 dp (ADR 0011).
const SIZES = isWebDesktop
  ? { default: 'h-8 gap-1.5 px-2.5', sm: 'h-7 gap-1 rounded-md px-2.5', lg: 'h-9 gap-1.5 px-3', icon: 'h-8 w-8', 'icon-sm': 'h-7 w-7 rounded-md' }
  : { default: 'h-12 gap-2 px-4', sm: 'h-11 gap-1.5 px-3', lg: 'h-14 gap-2 px-6', icon: 'h-12 w-12', 'icon-sm': 'h-11 w-11' }
const buttonVariants = cva('flex-row items-center justify-center rounded-lg border border-transparent web:select-none web:transition-colors web:duration-150 active:opacity-80 web:active:opacity-100 web:active:translate-y-px', {
  variants: {
    variant: {
      default: 'bg-primary web:hover:bg-primary/85',
      destructive: 'bg-destructive/10 web:hover:bg-destructive/20 dark:bg-destructive/20 dark:web:hover:bg-destructive/30',
      outline: 'border-border bg-background active:bg-muted web:hover:bg-muted dark:border-input dark:bg-input/30 dark:web:hover:bg-input/50',
      secondary: 'bg-secondary web:hover:bg-secondary/70',
      ghost: 'active:bg-muted web:hover:bg-muted dark:web:hover:bg-muted/50 dark:active:bg-muted/50',
    },
    size: SIZES,
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

const buttonTextVariants = cva(isWebDesktop ? 'text-sm font-medium' : 'text-[15px] font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
    },
    size: { default: '', sm: isWebDesktop ? 'text-[13px]' : '', lg: '', icon: '', 'icon-sm': '' },
  },
  defaultVariants: { variant: 'default' },
})

type Props = React.ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants> & { className?: string; haptics?: boolean }

export function Button({ className, variant, size, haptics = true, onPress, disabled, ...props }: Props) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        className={cn(buttonVariants({ variant, size }), disabled && 'opacity-50 web:pointer-events-none', className)}
        onPress={(e) => { if (haptics) haptic(); onPress?.(e) }}
        {...props}
      />
    </TextClassContext.Provider>
  )
}

/** Icon size inside buttons: 16 like shadcn on the desktop, a bit larger on touch screens. */
export const BUTTON_ICON = isWebDesktop ? 16 : 18
