import { listMessageTemplates } from '@/features/notifications/adapters/message-templates'
import { NotificationTemplatesForm } from '@/features/settings/ui/NotificationTemplatesForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

export default async function NotificationSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const templates = await listMessageTemplates(ctx.membership.orgId)

  return (
    <Main width="narrow" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Templates de notificação</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Personalize as mensagens enviadas por WhatsApp. Use os placeholders pra inserir dados do
          cliente automaticamente.
        </p>
      </header>
      <NotificationTemplatesForm templates={templates} canManage={canManage} />
    </Main>
  )
}
