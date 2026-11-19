// Config plugin: the foreground service type of the keep-alive service (modules/expo-iroh).
//
// The module declares dataSync. HERMES_UI_FGS_TYPE=remoteMessaging | specialUse | dataSync overrides it
// in the app manifest, with the matching FOREGROUND_SERVICE_* permission (and, for specialUse, the
// subtype text Google Play reviews). The service reads the type from the manifest at runtime.
// Background: docs/releasing.md → "Foreground service".
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins')

const PERMISSION = { dataSync: 'DATA_SYNC', remoteMessaging: 'REMOTE_MESSAGING', specialUse: 'SPECIAL_USE' }
const SERVICE = 'expo.modules.iroh.KeepAliveService'
const SUBTYPE = 'Keeps the connection to the user\'s own self-hosted agent backend open while the agent works on a request the user sent, so its reply and approval requests arrive as notifications.'

module.exports = function withKeepAliveType(config, { type = 'dataSync' } = {}) {
  if (!PERMISSION[type]) throw new Error(`HERMES_UI_FGS_TYPE must be one of ${Object.keys(PERMISSION).join(', ')}`)
  if (type === 'dataSync') return config
  return withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest
    m.$['xmlns:tools'] = 'http://schemas.android.com/tools'
    const perms = (m['uses-permission'] ||= [])
    perms.push({ $: { 'android:name': `android.permission.FOREGROUND_SERVICE_${PERMISSION[type]}` } })
    perms.push({ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'tools:node': 'remove' } })
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults)
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== SERVICE)
    app.service.push({
      $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': type, 'tools:replace': 'android:foregroundServiceType' },
      ...(type === 'specialUse' ? { property: [{ $: { 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': SUBTYPE } }] } : {}),
    })
    return c
  })
}
