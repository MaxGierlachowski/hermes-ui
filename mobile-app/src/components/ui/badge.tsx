import * as React from 'react'
import { View } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { TextClassContext } from './text'
import { cn } from '@/lib/utils'

const badgeVariants = cva('flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary',
      secondary: 'border-transparent bg-secondary',
      outline: 'border-border',
      warning: 'border-amber-500/40 bg-amber-500/10',
    },
  },
  defaultVariants: { variant: 'default' },
})
const badgeText = cva('text-xs font-medium', {
  variants: { variant: { default: 'text-primary-foreground', secondary: 'text-secondary-foreground', outline: 'text-muted-foreground', warning: 'text-amber-600 dark:text-amber-400' } },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }: React.ComponentProps<typeof View> & VariantProps<typeof badgeVariants> & { className?: string }) {
  return (
    <TextClassContext.Provider value={badgeText({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  )
}
