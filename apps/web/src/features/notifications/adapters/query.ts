import { isSnoozedAt } from '@/features/notifications/core/snooze'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import type { Firestore } from 'firebase-admin/firestore'

const StoredUnitNotification = Schema.Struct({
  type: Schema.String,
  customerId: Schema.optional(Schema.NullOr(Schema.String)),
  payload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  createdAt: Schema.optional(Schema.String),
  unitId: Schema.String,
  snoozedUntil: Schema.optional(Schema.NullOr(Schema.String)),
})

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

// Fetches unread notifications for a unit: total unread count + top N most
// recent. Unread = readAt null AND dispatchedAt null AND matching unitId, e:
// - NOT snoozed-into-the-future (snoozedUntil > now é oculto até chegar — AC-17)
// - quando `allowedTypes` é passado, só tipos visíveis pro role (AC-18/19)
// Ambos filtrados em JS pra manter count + items consistentes (Firestore não
// compõe bem esses predicados numa query só; o set de não-lidas é pequeno).
export async function fetchUnitNotifications({
  db,
  orgId,
  unitId,
  limit,
  now = new Date(),
  allowedTypes,
}: {
  db: Firestore
  orgId: string
  unitId: string
  limit: number
  now?: Date
  allowedTypes?: readonly string[]
}): Promise<UnitNotificationsResult> {
  const notificationsRef = db
    .collection('orgs')
    .doc(orgId)
    .collection('notifications')
    .withConverter(fsConverter(StoredUnitNotification))

  const unreadSnap = await notificationsRef
    .where('unitId', '==', unitId)
    .where('readAt', '==', null)
    .where('dispatchedAt', '==', null)
    .get()

  const allowed = allowedTypes ? new Set(allowedTypes) : null
  const visible = unreadSnap.docs
    .map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        type: d.type,
        customerId: d.customerId ?? null,
        payload: d.payload ?? {},
        createdAt: d.createdAt ?? null,
        unitId: d.unitId,
        snoozedUntil: d.snoozedUntil ?? null,
      }
    })
    .filter((n) => !isSnoozedAt(n.snoozedUntil, now))
    .filter((n) => !allowed || allowed.has(n.type))

  const items = visible
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)
    .map(({ snoozedUntil: _snoozedUntil, ...rest }) => rest)

  return { items, unreadCount: visible.length }
}
