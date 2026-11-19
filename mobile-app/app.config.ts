import type { ExpoConfig } from 'expo/config'
import version from './version.json'

// Everything that identifies a published build comes from the environment (.env, see .env.example),
// so a fork or a store release sets its own ids without editing this file. The defaults build a
// working app for local use.
const env = (name: string, fallback = '') => process.env[name]?.trim() || fallback

const appId = env('HERMES_UI_APP_ID', 'app.hermesui.mobile')
const androidPackage = env('HERMES_UI_ANDROID_PACKAGE', appId)
const iosBundleId = env('HERMES_UI_IOS_BUNDLE_ID', appId)
const name = env('HERMES_UI_APP_NAME', 'Hermes UI')
const scheme = env('HERMES_UI_SCHEME', 'hermesui')
// Pairing links are https://<static UI>/#iroh=…; the app offers to open them. Default: the hosted UI
// of this repository. A verified host (App Links / Universal Links) needs a domain you control.
const linkHost = env('HERMES_UI_LINK_HOST', 'maxgierlachowski.github.io')
const linkPath = process.env.HERMES_UI_LINK_PATH ?? '/hermes-ui'
const verifiedHost = env('HERMES_UI_VERIFIED_LINK_HOST')
const googleServices = env('GOOGLE_SERVICES_JSON') // FCM; without it push stays local-only
const googleServicesPlist = env('GOOGLE_SERVICES_PLIST')
const easProjectId = env('EAS_PROJECT_ID')

const CAMERA = 'Scan the pairing QR code and take photos for a chat.'
const MICROPHONE = 'Record voice messages for your agent.'
const PHOTOS = 'Attach images to a chat.'

const config: ExpoConfig = {
  name,
  slug: 'hermes-ui',
  ...(env('EXPO_OWNER') ? { owner: env('EXPO_OWNER') } : {}),
  version: version.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: iosBundleId,
    buildNumber: String(version.build),
    supportsTablet: true,
    ...(env('HERMES_UI_APPLE_TEAM_ID') ? { appleTeamId: env('HERMES_UI_APPLE_TEAM_ID') } : {}),
    ...(googleServicesPlist ? { googleServicesFile: googleServicesPlist } : {}),
    ...(verifiedHost ? { associatedDomains: [`applinks:${verifiedHost}`] } : {}),
    infoPlist: {
      NSCameraUsageDescription: CAMERA,
      NSMicrophoneUsageDescription: MICROPHONE,
      NSPhotoLibraryUsageDescription: PHOTOS,
      // iroh connects directly (UDP) when the backend is on the same network; iOS asks once.
      NSLocalNetworkUsageDescription: 'Connect directly to your own Hermes UI backend when it is on the same network.',
      // The iroh client brings its own TLS/QUIC (standard algorithms, not Apple's). See docs/releasing.md.
      ITSAppUsesNonExemptEncryption: env('HERMES_UI_IOS_NON_EXEMPT_ENCRYPTION', 'true') === 'true',
    },
    // Required-reason APIs used by React Native, Expo modules and the Rust library (std: file metadata,
    // monotonic clock). Collected data: none – chats go only to the user's own backend.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
      ],
    },
  },
  android: {
    package: androidPackage,
    versionCode: version.build,
    adaptiveIcon: {
      backgroundColor: '#6366f1',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE'],
    // Not needed, and each would need a justification in the Play Console: storage (the photo picker
    // needs none), overlays, background media playback, biometrics (the keystore is used without them).
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT',
    ],
    predictiveBackGestureEnabled: false,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: false,
        data: [{ scheme: 'https', host: linkHost, ...(linkPath ? { pathPrefix: linkPath } : {}) }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      ...(verifiedHost ? [{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: verifiedHost }], category: ['BROWSABLE', 'DEFAULT'] }] : []),
    ],
  },
  plugins: [
    // Web: one bundle instead of lazy route chunks. Lazy routes suspend the first render, and React
    // holds a revealed Suspense boundary back for up to 300 ms: that was most of the web cold start.
    ['expo-router', { asyncRoutes: { web: false, default: false } }],
    ['expo-splash-screen', { backgroundColor: '#fafafa', image: './assets/images/splash-icon.png', imageWidth: 96, dark: { backgroundColor: '#09090b', image: './assets/images/splash-icon.png' } }],
    ['expo-camera', { cameraPermission: CAMERA, recordAudioAndroid: false }],
    // Voice messages are recorded in the foreground and played in the app: no background audio mode.
    ['expo-audio', { microphonePermission: MICROPHONE, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
    ['expo-image-picker', { photosPermission: PHOTOS, cameraPermission: CAMERA }],
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#615fff' }],
    // No Face ID: the keystore entries are not behind biometrics.
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-share-intent', { androidIntentFilters: ['text/*', 'image/*'], disableIOS: true }],
    // targetSdk 36 = Google Play's requirement for new apps and updates since 31 Aug 2026.
    ['expo-build-properties', { android: { minSdkVersion: 24, targetSdkVersion: 36 }, ios: { deploymentTarget: '16.4' } }],
    // Release signing from mobile-app/.secrets (never committed) and the ABIs the iroh library is built for.
    ['./plugins/with-android-release', { abis: env('HERMES_UI_ABIS', 'arm64-v8a,x86_64').split(',') }],
    // Foreground service type of "Stay connected in the background" (dataSync unless overridden).
    ['./plugins/with-keepalive-type', { type: env('HERMES_UI_FGS_TYPE', 'dataSync') }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
}

export default config
