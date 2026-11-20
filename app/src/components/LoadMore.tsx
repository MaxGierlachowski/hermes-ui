// End of a board column: scrolling near it loads the next older page (store.loadMore); a column too
// short to scroll shows a button instead, so the board never pages through the whole history alone.
import { ActivityIndicator, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Text } from '@/components/ui/text'
import { loadMore, useStore } from '@/lib/store'
import { t } from '@/lib/i18n'

/** onScroll for a column list: within ~1.5 screens of the end, after the user scrolled, load more. */
export function onColumnScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
  const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
  if (contentOffset.y <= 0 || contentSize.height <= layoutMeasurement.height) return
  if (contentOffset.y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height * 1.5) loadMore()
}

export function LoadMoreFooter() {
  const more = useStore((s) => !!s.nextCursor)
  const loading = useStore((s) => s.loadingMore)
  if (!more) return null
  return (
    <View className="items-center py-2">
      <Pressable onPress={() => loadMore()} disabled={loading} accessibilityRole="button" className="h-10 flex-row items-center justify-center gap-2 rounded-lg px-4 active:bg-muted/60">
        {loading && <ActivityIndicator size="small" />}
        <Text className="text-[13px] text-muted-foreground">{loading ? t('Lädt …') : t('Ältere Chats laden')}</Text>
      </Pressable>
    </View>
  )
}
