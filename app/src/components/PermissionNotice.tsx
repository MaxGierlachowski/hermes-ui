// "Microphone not allowed" (or camera, notifications) with a way to fix it: the system settings in the
// desktop app and on phones, a hint about the site settings in a browser.
import { Pressable, View } from 'react-native'
import { ShieldAlert, X } from 'lucide-react-native'
import { Text } from '@/components/ui/text'
import { Icon } from '@/components/ui/icon'
import { canOpenPermissionSettings, openPermissionSettings, type PermissionKind } from '@/lib/permissions'
import { t } from '@/lib/i18n'

const TITLE: Record<PermissionKind, string> = {
  microphone: 'Mikrofon nicht erlaubt',
  camera: 'Kamera nicht erlaubt',
  notifications: 'Benachrichtigungen sind aus',
}

export function PermissionNotice({ kind, onClose }: { kind: PermissionKind; onClose?: () => void }) {
  return (
    <View className="flex-row items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2" accessibilityRole="alert">
      <Icon as={ShieldAlert} size={16} color="#d97706" />
      <View className="flex-1">
        <Text className="text-[13px] font-medium text-amber-800 dark:text-amber-200">{t(TITLE[kind])}</Text>
        {!canOpenPermissionSettings && <Text className="text-xs text-amber-800/80 dark:text-amber-200/80">{t('Erlaube den Zugriff in den Website-Einstellungen des Browsers und lade die Seite neu.')}</Text>}
      </View>
      {canOpenPermissionSettings && (
        <Pressable onPress={() => openPermissionSettings(kind)} className="rounded-md px-2 py-1 active:bg-amber-500/20 web:hover:bg-amber-500/20" accessibilityRole="link">
          <Text className="text-[13px] font-semibold text-amber-800 underline dark:text-amber-200">{t('Systemeinstellungen öffnen')}</Text>
        </Pressable>
      )}
      {onClose && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t('Schließen')} className="p-1">
          <Icon as={X} size={14} color="#d97706" />
        </Pressable>
      )}
    </View>
  )
}
