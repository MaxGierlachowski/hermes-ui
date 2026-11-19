// Config plugin: release signing from a local, git-ignored keystore and one ABI list for everything.
//
// Signing: android/app/build.gradle gets a `release` signing config read from
// mobile-app/.secrets/keystore.properties (storeFile, storePassword, keyAlias, keyPassword), or from the
// file named by HERMES_UI_KEYSTORE_PROPERTIES. Without that file, release builds stay debug-signed
// (Expo's default), so a fresh clone still builds.
//
// ABIs: React Native's libraries (reactNativeArchitectures) and the APK splits (one APK per ABI plus a
// universal one) use the same list; build the iroh library for the same ABIs
// (modules/expo-iroh/scripts/build-android.sh), so no ABI ends up with only half of the native code.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins')

const SIGNING = `
    // with-android-release: local keystore, never committed (mobile-app/.secrets/).
    def hermesKeystoreProps = new Properties()
    def hermesKeystoreFile = file(System.getenv('HERMES_UI_KEYSTORE_PROPERTIES') ?: "\${rootDir}/../.secrets/keystore.properties")
    if (hermesKeystoreFile.exists()) { hermesKeystoreFile.withInputStream { hermesKeystoreProps.load(it) } }
`

module.exports = function withAndroidRelease(config, { abis = ['arm64-v8a', 'x86_64'] } = {}) {
  config = withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'reactNativeArchitectures'))
    c.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: abis.join(',') })
    return c
  })
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents
    if (g.includes('with-android-release')) return c
    g = g.replace(/android\s*\{/, (m) => `${m}\n${SIGNING}`)
    g = g.replace(/signingConfigs\s*\{/, (m) => `${m}
        release {
            if (hermesKeystoreFile.exists()) {
                storeFile file(hermesKeystoreProps['storeFile'])
                storePassword hermesKeystoreProps['storePassword']
                keyAlias hermesKeystoreProps['keyAlias']
                keyPassword hermesKeystoreProps['keyPassword']
            }
        }`)
    // One APK per ABI: a universal APK would also carry the 32-bit libraries of prebuilt AARs without the iroh library.
    g = g.replace(/\n    packagingOptions\s*\{/, (m) => `\n    splits {\n        abi {\n            enable true\n            reset()\n            include ${abis.map((a) => `"${a}"`).join(', ')}\n            universalApk false\n        }\n    }${m}`)
    // The release build type points at the debug config in Expo's template; switch it when a keystore exists.
    g = g.replace(/(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/, '$1signingConfig hermesKeystoreFile.exists() ? signingConfigs.release : signingConfigs.debug')
    c.modResults.contents = g
    return c
  })
}
