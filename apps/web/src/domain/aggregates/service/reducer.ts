import type { EventMeta } from '@/domain/effect/event-store'
import type { ServiceEvent } from './events'
import type { ServiceState } from './types'

export function applyServiceEvent(
  state: ServiceState,
  event: ServiceEvent,
  meta: EventMeta,
): ServiceState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'service.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'service.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'service.deleted':
      return base
  }
}
