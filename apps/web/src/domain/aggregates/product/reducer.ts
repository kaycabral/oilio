import type { EventMeta } from '@/domain/effect/event-store'
import type { ProductEvent } from './events'
import type { ProductState } from './types'

export function applyProductEvent(
  state: ProductState,
  event: ProductEvent,
  meta: EventMeta,
): ProductState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'product.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'product.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'product.deleted':
      return base
  }
}
