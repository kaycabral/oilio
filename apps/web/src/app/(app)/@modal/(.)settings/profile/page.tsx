import ProfileSettingsPage from '@/app/(app)/settings/profile/page'
import { RouteModal } from '@/features/settings/ui/RouteModal'

// Intercepts a client-side navigation to /settings/profile and renders the SAME
// server page inside the Configurações modal (brief 0090, AC-04). A direct load
// or refresh of /settings/profile bypasses this and renders the full page. The
// `(.)` matches `settings` on the same route level — `@modal` is a slot, not a
// segment, so the settings segment is one level up in routing terms only.
export default function ProfileModal() {
  return (
    <RouteModal activeSection="profile">
      <ProfileSettingsPage />
    </RouteModal>
  )
}
