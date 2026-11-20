// Browser fallback for lib/menu.ts: a small popover at the pointer / below the button. (The desktop
// app shows a native macOS menu instead and never renders this.)
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Check } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { closeMenu, useMenu } from '@/lib/menu'
import { useKeydown } from '@/lib/web-input'
import { cn } from '@/lib/utils'
import { useLayer } from '@/lib/nav'
import { shadow } from '@/lib/shadow'

const W = 240

export function MenuHost() {
  const menu = useMenu()
  const { width, height } = useWindowDimensions()
  useLayer(!!menu)
  useKeydown((e) => { if (menu && e.key === 'Escape') { e.preventDefault(); closeMenu() } })
  if (!menu) return null
  const x = Math.min(menu.at.align === 'right' ? menu.at.x - W : menu.at.x, width - W - 8)
  const rows = menu.items.length
  const y = Math.min(menu.at.y, height - rows * 30 - 16)
  return (
    <Pressable className="absolute inset-0 z-50" onPress={closeMenu} accessibilityRole="none">
      {/* The web UI's popover menu: hairline ring, soft shadow, 28 px rows. */}
      <View {...({ dataSet: { hkAnim: 'menu' } } as object)} className="absolute rounded-lg border border-foreground/10 bg-popover p-1" style={[{ left: Math.max(8, x), top: Math.max(8, y), width: W }, shadow('md')]}>
        {menu.items.map((it, i) => it === '-' ? <View key={i} className="my-1 h-px bg-border" /> : (
          <Pressable
            key={it.id}
            disabled={it.enabled === false}
            onPress={() => { closeMenu(); menu.onPick(it.id) }}
            className={cn('h-7 flex-row items-center gap-2 rounded-md px-1.5 web:hover:bg-accent', it.enabled === false && 'opacity-50')}
          >
            <View className="w-4">{it.checked && <Icon as={Check} size={14} />}</View>
            <Text className={cn('flex-1 text-sm', it.destructive && 'text-destructive')} numberOfLines={1}>{it.text}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  )
}
