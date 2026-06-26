import {
  filterNotificationsForRole,
  type NotificationView,
} from '@/features/notifications/core/notification-list'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listNotificationsForUnit } from '@/shared/org/notification-read'
import { redirect } from 'next/navigation'
import 'server-only'

export type NotificationsPageData = {
  notifications: NotificationView[]
  activeType: string
}

// Imperative shell for the notifications list route. Notifications are
// operational (brief 0039, AC-01): they follow the active unit from the shared
// context (0029) — the per-feature unit filter is gone. The doc→view mapping
// and role visibility live in core. Backend-aware (brief 0060, Grupo C): the
// unit read is `listNotificationsForUnit` (Postgres typed table under RLS, or
// Firestore); the type filter + recency sort + 50-cap run in JS over the
// unit-scoped set (small), identical for both backends.
export async function loadNotificationsPage(searchParams: {
  type?: string
  page?: string
}): Promise<NotificationsPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const orgId = ctx.membership.orgId
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)

  // No active unit (org without units yet) → nothing to scope to; render the
  // empty state instead of issuing a `unitId == null` query. The read applies
  // `type` filter + `createdAt` desc order + the 50-cap at the source (bounded
  // read, both backends), so no JS sort/slice is needed here.
  const docs = activeUnitId
    ? await listNotificationsForUnit(orgId, activeUnitId, { type: searchParams.type })
    : []

  const notifications = filterNotificationsForRole(
    docs.map((d) => ({ id: d.id, data: d })),
    ctx.membership.role,
  )

  return { notifications, activeType: searchParams.type ?? '' }
}
