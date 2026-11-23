export function competenceOf(tag: string, payload: Record<string, unknown>): string | null {
  switch (tag) {
    case 'order.closed':
      return readString(payload['closedAt'])
    case 'order.reopened':
      return readString(payload['reopenedAt'])
    case 'commission.created':
      return readNested(payload, 'data', 'createdAt')
    case 'charge.succeeded':
      return readNested(payload, 'changes', 'periodStartAt')
    case 'charge.refunded':
      return readNested(payload, 'changes', 'refundedAt')
    default:
      return null
  }
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function readNested(payload: Record<string, unknown>, key: string, field: string): string | null {
  const nested = payload[key]
  if (nested !== null && typeof nested === 'object') {
    const record: Record<string, unknown> = { ...nested }
    return readString(record[field])
  }
  return null
}
