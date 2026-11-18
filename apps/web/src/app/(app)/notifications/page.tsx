import { loadNotificationsPage } from '@/features/notifications/adapters/load-notifications'
import { NotificationsList } from '@/features/notifications/ui/NotificationsList'
import { isFeatureEnabled } from '@/shared/flags'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>
}) {
  if (!isFeatureEnabled('notifications')) notFound()

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
