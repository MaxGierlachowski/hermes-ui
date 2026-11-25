// The messages of a thread, newest at the bottom. Native: an inverted FlashList (recycled cells, starts
// at the newest message, the composer sits right below). Web: ThreadList.web.tsx.
import type { ReactElement } from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import type { ThreadMessage } from '@shared/types'

export type Row = { key: string; kind: 'msg'; m: ThreadMessage } | { key: string; kind: 'stream'; text: string } | { key: string; kind: 'prompts' }

const RowGap = () => <View className="h-3" />

/** `rows` come newest first (row 0 sits at the bottom of the screen). */
export function ThreadList<R extends { key: string; kind: string }>({ rows, renderRow, footer, bottomInset = 0 }: { rows: R[]; renderRow: (r: R) => ReactElement; footer?: ReactElement; /** Room below the newest row (e.g. for a pill floating above the composer). */ bottomInset?: number }) {
  return (
    <FlashList
      inverted
      data={rows}
      keyExtractor={(r) => r.key}
      getItemType={(r) => (r.kind === 'msg' && 'm' in r ? (r as unknown as { m: { role: string } }).m.role : r.kind)}
      // Inverted: the content's top edge is the bottom of the screen.
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16 + bottomInset, paddingBottom: 16 }}
      ItemSeparatorComponent={RowGap}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      renderItem={({ item }) => renderRow(item)}
      ListFooterComponent={footer}
    />
  )
}
