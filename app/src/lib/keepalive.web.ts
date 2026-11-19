// Web / desktop: nothing to keep alive. The desktop app keeps running in the tray, a browser tab as long
// as it is open. Same API as keepalive.ts (Android foreground service).
export type KeepAliveMode = 'auto' | 'always' | 'off'
let mode: KeepAliveMode = 'auto'
export async function setKeepAliveMode(m: KeepAliveMode) { mode = m }
export const keepAliveMode = () => mode
export async function startKeepAlivePolicy() {}
