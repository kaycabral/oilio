// Reads for the `notification` context (brief 0060, Grupo C). Reads the typed
// `notifications` table under RLS (unit-scoped GUC). No PII (the payload
// references ids, never personal data inline — ADR 0010).
//
// The notification write path (cron `generate-daily`/`generate-hourly` →
// `createNotification` → `appendEvent` → `runTransaction`) already sets
// `app.current_org` from the aggregate path inside `runTransaction`, so the cron
// write needs no extra GUC handling. These helpers cover the DIRECT-read sites
// that bypass the event store (list/popover/dispatch).

import type { FirestoreDoc } from '@/domain/effect'
import { rowToDoc, type NotificationRow } from '@/shared/db/pg/effect/notification-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'

// A notification is hidden while `snoozedUntil` is in the future (AC-17). Pure
// predicate inlined here (not imported from `features/notifications/core`):
// `shared/` is infra below `features/` and must not import upward (layering).
function isSnoozedAt(snoozedUntil: string | null, now: Date): boolean {
  if (!snoozedUntil) return false
  return new Date(snoozedUntil).getTime() > now.getTime()
}

// The reduced notification doc shape the read sites consume. Returned as
// `FirestoreDoc` so callers decode/map against the canonical shape.
export type NotificationDoc = FirestoreDoc & { id: string }

// The most-recent notifications for a unit, ordered by `createdAt` desc and
// bounded by `limit` (default 50 — the same server-side cap the Firestore query
// enforced; without it a unit's full notification history would be fetched into
// memory just to slice the top N). An optional `type` narrows to one
// `NotificationType`. Reads the typed table under RLS with the unit GUC, applying
// order+limit at the source so the read stays bounded as notifications accumulate.
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

// The unread notification shape the popover/route surface consumes (mirrors
// `UnitNotification` from the Firestore `fetchUnitNotifications`).
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

// Postgres equivalent of `fetchUnitNotifications` (brief 0018 Grupo A): unread
// notifications for a unit (total unread count + top N most recent). Unread =
// `read_at IS NULL AND dispatched_at IS NULL`, matching the unit, read under RLS
// with the unit GUC. The snooze/role predicates run in JS (same as Firestore) so
// count + items stay consistent over the small unread set:
//   - NOT snoozed-into-the-future (`snoozedUntil > now` is hidden — AC-17)
//   - when `allowedTypes` is passed, only role-visible types (AC-18/19)
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

  // `created_at` is `timestamptz` (brief 0068 D1): the pg driver returns a
  // `Date`, so order by instant (robust to Date or ISO string) rather than the
  // old lexicographic `localeCompare`, and normalize to ISO on the way out.
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

// A single notification by id (dispatch flow). Reads the typed row under RLS.
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
