import { useSyncExternalStore } from 'react'
import { getConnection, onConnectionChange } from './backend'

export const useConnection = () => useSyncExternalStore(onConnectionChange, getConnection)
