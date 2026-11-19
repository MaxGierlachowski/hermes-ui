import { router } from 'expo-router'
import { SearchPanel } from '@/components/SearchPanel'
import { showThread } from '@/lib/nav'

/** Search as a screen (phone). The wide layout opens the same panel as the ⌘K palette. */
export default function Search() {
  return <SearchPanel onClose={() => router.back()} onPick={(id) => showThread(id, { replace: true })} />
}
