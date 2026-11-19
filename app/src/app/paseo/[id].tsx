import { router, useLocalSearchParams } from 'expo-router'
import { PaseoPane } from '@/components/paseo/PaseoPane'

/** Paseo agents of a chat as a screen (phone). The wide layout shows the same pane next to the board. */
export default function PaseoScreen() {
  const { id, agent } = useLocalSearchParams<{ id: string; agent?: string }>()
  return <PaseoPane id={decodeURIComponent(id)} agent={agent} onBack={() => router.back()} />
}
