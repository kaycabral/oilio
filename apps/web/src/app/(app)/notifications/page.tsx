import { loadNotificationsPage } from '@/features/notifications/adapters/load-notifications'
import { NotificationsList } from '@/features/notifications/ui/NotificationsList'
import { Main } from '@cbrl/design'

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>
}) {
  const params = await searchParams
  const { notifications, activeType } = await loadNotificationsPage(params)

  return (
    <Main width="default" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Notificações</h1>
      </header>
      <NotificationsList notifications={notifications} activeType={activeType} />
    </Main>
  )
}
