// Where a refused permission can be turned on again. Native: the app's page in the system settings.
// Web / desktop: permissions.web.ts.
import { Linking } from 'react-native'

export type PermissionKind = 'microphone' | 'camera' | 'notifications'
/** True when openPermissionSettings can open the right place on this platform. */
export const canOpenPermissionSettings = true
export const openPermissionSettings = (_kind: PermissionKind) => Linking.openSettings()
