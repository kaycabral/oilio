import { type Role, allowedNotificationTypesForRole } from '@/domain'

export type NotificationView = {
  id: string
  type: string
  customerId: string | null
  subscriptionId: string | null
  payload: Record<string, unknown>
  createdAt: string | null
  readAt: string | null
  dispatchedAt: string | null
  unitId: string
  source: string
}

type RawDoc = { id: string; data: Record<string, unknown> }

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asPayload(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return { ...v }
}

export function toNotificationView(doc: RawDoc): NotificationView {
  const d = doc.data
  return {
    id: doc.id,
    type: asString(d.type),
    customerId: asNullableString(d.customerId),
    subscriptionId: asNullableString(d.subscriptionId),
    payload: asPayload(d.payload),
    createdAt: asNullableString(d.createdAt),
    readAt: asNullableString(d.readAt),
    dispatchedAt: asNullableString(d.dispatchedAt),
    unitId: asString(d.unitId),
    source: asString(d.source),
  }
}

export function filterNotificationsForRole(docs: RawDoc[], role: Role): NotificationView[] {
  const allowed = new Set<string>(allowedNotificationTypesForRole(role))
  return docs.map(toNotificationView).filter((n) => allowed.has(n.type))
}
