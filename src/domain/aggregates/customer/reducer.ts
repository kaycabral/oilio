import type { EventMeta } from '@/domain/effect/event-store'
import type { CustomerEvent } from './events'
import type { CustomerState } from './types'

export function applyCustomerEvent(
  state: CustomerState,
  event: CustomerEvent,
  meta: EventMeta,
): CustomerState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'customer.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'customer.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'customer.deleted':
      return base
  }
}
