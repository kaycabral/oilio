import NotificationSettingsPage from '@/app/(app)/settings/notifications/page'
import { RouteModal } from '@/features/settings/ui/RouteModal'

// Intercepts /settings/notifications as the Notificações section of the
// Configurações modal (brief 0090). Direct load / refresh renders the full page.
export default function NotificationsModal() {
  return (
    <RouteModal activeSection="notifications">
      <NotificationSettingsPage />
    </RouteModal>
  )
}
