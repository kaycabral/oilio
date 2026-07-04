import PrivacySettingsPage from '@/app/(app)/settings/privacy/page'
import { RouteModal } from '@/features/settings/ui/RouteModal'

// Intercepts /settings/privacy as the Privacidade section of the Configurações
// modal (brief 0090). Direct load / refresh renders the full page (server-first,
// LGPD deep-links from email keep resolving).
export default function PrivacyModal() {
  return (
    <RouteModal activeSection="privacy">
      <PrivacySettingsPage />
    </RouteModal>
  )
}
