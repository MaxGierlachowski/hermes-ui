import type { LucideIcon, LucideProps } from 'lucide-react-native'
import { useColorScheme } from 'nativewind'
import { THEME } from '@/lib/theme'

type Tone = 'foreground' | 'muted-foreground' | 'primary' | 'primary-foreground' | 'destructive'

/** Lucide icon in a theme colour (icons take colour props, not className). */
export function Icon({ as: As, tone = 'foreground', color, size = 20, ...props }: LucideProps & { as: LucideIcon; tone?: Tone }) {
  const { colorScheme } = useColorScheme()
  return <As size={size} color={color ?? THEME[colorScheme === 'dark' ? 'dark' : 'light'][tone]} {...props} />
}
