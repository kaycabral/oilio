import { NotificationConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { computeSnoozeUntil, type SnoozeOption } from '@/features/notifications/core/snooze'
import { emitEvent } from '@/shared/effect-bridge'

export type MarkResult = { ok: true } | { ok: false; error: string }

export async function markNotificationRead(
  orgId: string,
  notificationId: string,
  actorUid: string,
): Promise<MarkResult> {
  const result = await emitEvent(
    NotificationConfig,
    aggregateRef(NotificationConfig, orgId, notificationId),
    { _tag: 'notification.read', actorId: actorUid, payload: {} },
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function snoozeNotification({
  orgId,
  notificationId,
  option,
  actorUid,
  tz,
  now = new Date(),
}: {
  orgId: string
  notificationId: string
  option: SnoozeOption
  actorUid: string
  tz: string
  now?: Date
}): Promise<MarkResult> {
  const snoozedUntil = computeSnoozeUntil(option, now, tz)
  const result = await emitEvent(
    NotificationConfig,
    aggregateRef(NotificationConfig, orgId, notificationId),
    { _tag: 'notification.snoozed', actorId: actorUid, payload: { snoozedUntil } },
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
