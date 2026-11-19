const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)
// ../shared holds the TypeScript shared with the web UI (types, SSE parser, pairing links, texts).
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../shared')]

module.exports = withNativeWind(config, { input: './src/global.css' })
