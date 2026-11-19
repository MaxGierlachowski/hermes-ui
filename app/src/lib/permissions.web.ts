// Desktop app: the macOS privacy pane for the permission (x-apple.systempreferences:… through the
// shell). In a browser the decision lives in the site settings, which a page cannot open.
import { invoke, isDesktop } from './desktop.web'

export type PermissionKind = 'microphone' | 'camera' | 'notifications'
export const canOpenPermissionSettings = isDesktop
export const openPermissionSettings = (kind: PermissionKind) => invoke('open_privacy_settings', { kind })
