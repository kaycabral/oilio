import {
  filterNotificationsForRole,
  type NotificationView,
} from '@/features/notifications/core/notification-list'
import { getAdminFirestore } from '@/shared/db'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/tenant/active-unit'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { redirect } from 'next/navigation'
import 'server-only'

export type NotificationsPageData = {
  notifications: NotificationView[]
  activeType: string
}

// Imperative shell for the notifications list route. Notifications are
// operational (brief 0039, AC-01): they follow the active unit from the shared
// context (0029) — the per-feature unit filter is gone. The doc→view mapping
// and role visibility live in core.
export async function loadNotificationsPage(searchParams: {
  type?: string
  page?: string
}): Promise<NotificationsPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const tenantId = ctx.membership.tenantId
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)

  const { activeUnitId } = await resolveActiveUnit(ctx.membership)

  // No active unit (tenant without units yet) → nothing to scope to; render the
  // empty state instead of issuing a `unitId == null` query.
  let query = activeUnitId
    ? tenantRef
        .collection('notifications')
        .where('unitId', '==', activeUnitId)
        .orderBy('createdAt', 'desc')
        .limit(50)
    : null

  if (query && searchParams.type) {
    query = tenantRef
      .collection('notifications')
      .where('unitId', '==', activeUnitId)
      .where('type', '==', searchParams.type)
      .orderBy('createdAt', 'desc')
      .limit(50)
  }

  const snap = query ? await query.get() : null
  const notifications = filterNotificationsForRole(
    (snap?.docs ?? []).map((doc) => ({ id: doc.id, data: doc.data() })),
    ctx.membership.role,
  )

  return { notifications, activeType: searchParams.type ?? '' }
}
