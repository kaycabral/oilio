import { listMessageTemplates } from '@/features/notifications/adapters/message-templates'
import { NotificationTemplatesForm } from '@/features/settings/ui/NotificationTemplatesForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { SettingsSection } from '@cbrl/design'
import { redirect } from 'next/navigation'

export default async function NotificationSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

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

  return (
    <SettingsSection
      title="Templates de notificação"
      description="Personalize as mensagens enviadas por WhatsApp. Use os placeholders pra inserir dados do cliente automaticamente."
    >
      <NotificationTemplatesForm templates={templates} canManage={canManage} />
    </SettingsSection>
  )
}
