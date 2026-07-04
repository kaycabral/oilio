import BillingPage from '@/app/(app)/settings/billing/page'
import NotificationSettingsPage from '@/app/(app)/settings/notifications/page'
import PrivacySettingsPage from '@/app/(app)/settings/privacy/page'
import ProfileSettingsPage from '@/app/(app)/settings/profile/page'
import {
  type SettingsSectionKey,
  toSettingsSectionKey,
} from '@/features/settings/ui/settings-sections'
import { notFound } from 'next/navigation'

// A single dynamic intercepting page for every Configurações section (brief
// 0090, AC-04). All four `/settings/*` client navigations match this one route,
// so the sibling `layout.tsx` (which holds the Dialog + nav) is NOT remounted
// when the user switches sections — only this panel re-renders. That kills the
// modal flicker, the size jump and the tablet keyboard re-focus that a
// route-per-section (remount-every-switch) design caused.
//
// Each branch renders the SAME server page the full route renders, so the guard
// + fetch + RLS + LGPD stay server-side; a direct load / refresh bypasses the
// interception and renders the full page.
const PANELS: Record<SettingsSectionKey, () => React.ReactNode> = {
  profile: () => <ProfileSettingsPage />,
  privacy: () => <PrivacySettingsPage />,
  billing: () => <BillingPage />,
  notifications: () => <NotificationSettingsPage />,
}

export default async function SettingsSectionModal({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  const key = toSettingsSectionKey(section)
  if (!key) notFound()
  return PANELS[key]()
}
