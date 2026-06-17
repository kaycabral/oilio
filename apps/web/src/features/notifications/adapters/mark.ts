import { NotificationConfig } from '@/domain/aggregates'
import { computeSnoozeUntil, type SnoozeOption } from '@/features/notifications/core/snooze'
import { emitEvent } from '@/shared/effect-bridge'

export type MarkResult = { ok: true } | { ok: false; error: string }

// AC-16: marca como lida (sem agir) — emite notification.read (seta readAt).
export async function markNotificationRead(
  tenantId: string,
  notificationId: string,
  actorUid: string,
): Promise<MarkResult> {
  const result = await emitEvent(
    NotificationConfig,
    `tenants/${tenantId}/notifications/${notificationId}`,
    { _tag: 'notification.read', actorId: actorUid, payload: {} },
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

// AC-17: adia — emite notification.snoozed com snoozedUntil futuro. A
// notificação some do popover (fetchUnitNotifications filtra) até chegar.
export async function snoozeNotification({
  tenantId,
  notificationId,
  option,
  actorUid,
  tz,
  now = new Date(),
}: {
  tenantId: string
  notificationId: string
  option: SnoozeOption
  actorUid: string
  tz: string
  now?: Date
}): Promise<MarkResult> {
  const snoozedUntil = computeSnoozeUntil(option, now, tz)
  const result = await emitEvent(
    NotificationConfig,
    `tenants/${tenantId}/notifications/${notificationId}`,
    { _tag: 'notification.snoozed', actorId: actorUid, payload: { snoozedUntil } },
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
