import type { ExpoConfig } from 'expo/config'

// Generic by default; a fork sets its own ids and pairing-link host through the environment.
const pkg = process.env.HERMES_UI_ANDROID_PACKAGE || 'app.hermesui.mobile'
// Pairing links are https://<static UI>/#iroh=…: the app offers to open them (unverified link,
// Android asks once; see README). Default = the hosted UI of this repo.
const linkHost = process.env.HERMES_UI_LINK_HOST || 'maxgierlachowski.github.io'
const linkPath = process.env.HERMES_UI_LINK_PATH ?? '/hermes-ui'
const googleServices = process.env.GOOGLE_SERVICES_JSON // FCM; without it push stays local-only

const config: ExpoConfig = {
  name: 'Hermes UI',
  slug: 'hermes-ui',
  version: '0.2.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'hermesui',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: process.env.HERMES_UI_IOS_BUNDLE_ID || pkg,
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Scan the pairing QR code and take photos for a chat.',
      NSMicrophoneUsageDescription: 'Record voice messages for Hermes.',
      NSPhotoLibraryUsageDescription: 'Attach images to a chat.',
    },
  },
  android: {
    package: pkg,
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: '#6366f1',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE'],
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW'],
    predictiveBackGestureEnabled: false,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: false,
        data: [{ scheme: 'https', host: linkHost, ...(linkPath ? { pathPrefix: linkPath } : {}) }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#fafafa', image: './assets/images/splash-icon.png', imageWidth: 96, dark: { backgroundColor: '#09090b', image: './assets/images/splash-icon.png' } }],
    ['expo-camera', { cameraPermission: 'Scan the pairing QR code and take photos for a chat.', recordAudioAndroid: false }],
    ['expo-audio', { microphonePermission: 'Record voice messages for Hermes.' }],
    ['expo-image-picker', { photosPermission: 'Attach images to a chat.', cameraPermission: 'Take photos for a chat.' }],
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#615fff' }],
    'expo-secure-store',
    ['expo-share-intent', { androidIntentFilters: ['text/*', 'image/*'], disableIOS: true }],
    ['expo-build-properties', { android: { minSdkVersion: 24 } }],
    // Release signing from mobile-app/.secrets (never committed) and the ABIs the iroh library is built for.
    ['./plugins/with-android-release', { abis: (process.env.HERMES_UI_ABIS || 'arm64-v8a,x86_64').split(',') }],
  ],
  experiments: { typedRoutes: true },
}

export default config
