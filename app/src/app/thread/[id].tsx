import { useLocalSearchParams } from 'expo-router'
import { ThreadPane } from '@/components/thread/ThreadPane'

/** A chat as a screen (phone, narrow window). The wide layout shows the same pane next to the board. */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ThreadPane sessionId={decodeURIComponent(id)} />
}
