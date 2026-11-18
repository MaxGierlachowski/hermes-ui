/** Short vibration on touch actions where the platform allows it (Android; iOS Safari has no Vibration API). */
export function haptic(ms = 10) {
  try { if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms) } catch { /* unsupported */ }
}
