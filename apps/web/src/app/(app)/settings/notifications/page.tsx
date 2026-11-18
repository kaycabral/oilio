import { listMessageTemplates } from '@/features/notifications/adapters/message-templates'
import { settingsSectionMeta } from '@/features/settings/core/settings-sections'
import { NotificationTemplatesForm } from '@/features/settings/ui/NotificationTemplatesForm'
import { isAuthConfigured } from '@/shared/auth/config'
import { getSessionUser } from '@/shared/auth/session'
import { isFeatureEnabled } from '@/shared/flags'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { SettingsSection } from '@cbrl/design'
import { notFound, redirect } from 'next/navigation'

export default async function NotificationSettingsPage() {
  if (!isFeatureEnabled('notifications')) notFound()

  if (!isAuthConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
    section: 'notifications',
  })

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const templates = await listMessageTemplates(ctx.membership.orgId)

  const meta = settingsSectionMeta('notifications')
  return (
    <SettingsSection title={meta.label} description={meta.description}>
      <NotificationTemplatesForm templates={templates} canManage={canManage} />
    </SettingsSection>
  )
}
