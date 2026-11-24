// iOS shows PDFs in a WebView (WKWebView renders them); Android's WebView cannot, and video needs
// expo-video: both fall back to the file card with Download there. Web: viewers.web.tsx.
import { Platform } from 'react-native'
import { WebView } from 'react-native-webview'

export const canShowPdf = Platform.OS === 'ios'
export const canShowVideo = false

export function PdfView({ uri }: { uri: string; title: string; onError: (e: unknown) => void }) {
  return <WebView source={{ uri }} originWhitelist={['file://*']} allowingReadAccessToURL={uri} javaScriptEnabled={false} style={{ flex: 1 }} />
}

export function VideoView(_: { uri: string }) {
  return null
}
