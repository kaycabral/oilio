import type { StoredDoc } from '@/domain/effect'
import { rowToDoc, type NotificationRow } from '@/shared/db/pg/effect/notification-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'

function isSnoozedAt(snoozedUntil: string | null, now: Date): boolean {
  if (!snoozedUntil) return false
  return new Date(snoozedUntil).getTime() > now.getTime()
}

export type NotificationDoc = StoredDoc & { id: string }

export async function listNotificationsForUnit(
  orgId: string,
  unitId: string,
  opts: { type?: string; limit?: number } = {},
): Promise<NotificationDoc[]> {
  const limit = opts.limit ?? 50
  const rows = await readUnderRls<NotificationRow>(
    orgId,
    (client) =>
      opts.type
        ? client
            .query<NotificationRow>(
              `SELECT * FROM notifications WHERE org_id = $1 AND unit_id = $2 AND type = $3
                 ORDER BY created_at DESC NULLS LAST LIMIT $4`,
              [orgId, unitId, opts.type, limit],
            )
            .then((res) => res.rows)
        : client
            .query<NotificationRow>(
              `SELECT * FROM notifications WHERE org_id = $1 AND unit_id = $2
                 ORDER BY created_at DESC NULLS LAST LIMIT $3`,
              [orgId, unitId, limit],
            )
            .then((res) => res.rows),
    unitId,
  )
  return rows.map((r) => ({ ...rowToDoc(r), id: r.id }))
}

export type UnitNotification = {
  id: string
  type: string
  customerId: string | null
  payload: Record<string, unknown>
  createdAt: string | null
  unitId: string
}

export type UnitNotificationsResult = {
  items: UnitNotification[]
  unreadCount: number
}

export async function fetchUnreadNotificationsForUnit({
  orgId,
  unitId,
  limit,
  now = new Date(),
  allowedTypes,
}: {
  orgId: string
  unitId: string
  limit: number
  now?: Date
  allowedTypes?: readonly string[]
}): Promise<UnitNotificationsResult> {
  const rows = await readUnderRls<NotificationRow>(
    orgId,
    (client) =>
      client
        .query<NotificationRow>(
          `SELECT * FROM notifications
             WHERE org_id = $1 AND unit_id = $2 AND read_at IS NULL AND dispatched_at IS NULL`,
          [orgId, unitId],
        )
        .then((res) => res.rows),
    unitId,
  )

  const allowed = allowedTypes ? new Set(allowedTypes) : null
  const visible = rows
    .filter((r) => !isSnoozedAt(r.snoozed_until, now))
    .filter((r) => !allowed || allowed.has(r.type))

  const instant = (v: Date | string | null | undefined): number =>
    v == null ? 0 : new Date(v).getTime()
  const items: UnitNotification[] = visible
    .slice()
    .sort((a, b) => instant(b.created_at) - instant(a.created_at))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      type: r.type,
      customerId: r.customer_id,
      payload: r.payload,
      createdAt: r.created_at == null ? r.created_at : new Date(r.created_at).toISOString(),
      unitId: r.unit_id,
    }))

  return { items, unreadCount: visible.length }
}

export async function getNotificationById(
  orgId: string,
  notificationId: string,
): Promise<NotificationDoc | null> {
  const rows = await readUnderRls<NotificationRow>(orgId, (client) =>
    client
      .query<NotificationRow>('SELECT * FROM notifications WHERE org_id = $1 AND id = $2', [
        orgId,
        notificationId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? { ...rowToDoc(row), id: row.id } : null
}
