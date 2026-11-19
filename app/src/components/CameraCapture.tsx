// Native builds take photos with the system camera (expo-image-picker, Composer.pickImage); this
// placeholder only keeps the import of CameraCapture.web.tsx type-safe.
import type { Picked } from './Composer'

export function CameraCapture(_props: { open: boolean; onClose: () => void; onPhoto: (p: Picked) => void; onDenied: () => void }) {
  return null
}
