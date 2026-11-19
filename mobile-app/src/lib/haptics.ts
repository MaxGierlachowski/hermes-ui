import * as Haptics from 'expo-haptics'

/** Light tick for taps on primary actions; heavier for confirmations. Never throws. */
export const haptic = (kind: 'tap' | 'select' | 'success' | 'warning' = 'tap') => {
  const p = kind === 'select' ? Haptics.selectionAsync()
    : kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === 'warning' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  p.catch(() => {})
}
