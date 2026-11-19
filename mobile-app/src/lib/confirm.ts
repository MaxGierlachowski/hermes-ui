// A yes/no question and a notice. Native: the system alert. Web / desktop: confirm.web.ts
// (React Native Web's Alert does nothing).
import { Alert } from 'react-native'
import { t } from './i18n'

export const confirm = (title: string, message: string, action: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: t('Abbrechen'), style: 'cancel', onPress: () => resolve(false) },
    { text: action, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export const notice = (title: string, message: string) => Alert.alert(title, message)
