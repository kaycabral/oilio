export type NotificationSummary = {
  id: string
  type: string
  customerId: string | null
  payload: Record<string, unknown>
  createdAt: string
  unitId: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function isNotificationSummary(v: unknown): v is NotificationSummary {
  if (!isRecord(v)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    (v.customerId === null || typeof v.customerId === 'string') &&
    isRecord(v.payload) &&
    typeof v.createdAt === 'string' &&
    typeof v.unitId === 'string'
  )
}
