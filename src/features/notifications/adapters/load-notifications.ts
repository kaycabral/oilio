import {
  filterNotificationsForRole,
  type NotificationView,
} from '@/features/notifications/core/notification-list'
import { getSessionUser } from '@/shared/auth/session'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listNotificationsForUnit } from '@/shared/org/notification-read'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import 'server-only'

export type NotificationsPageData = {
  notifications: NotificationView[]
  activeType: string
}

export async function loadNotificationsPage(searchParams: {
  type?: string
  page?: string
}): Promise<NotificationsPageData> {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgId = ctx.membership.orgId
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)

  const docs = activeUnitId
    ? await listNotificationsForUnit(orgId, activeUnitId, { type: searchParams.type })
    : []

  const notifications = filterNotificationsForRole(
    docs.map((d) => ({ id: d.id, data: d })),
    ctx.membership.role,
  )

  return { notifications, activeType: searchParams.type ?? '' }
}
