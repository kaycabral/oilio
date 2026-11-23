import type { EventMeta } from '@/domain/effect/event-store'
import type { CommissionEvent } from './events'
import type { CommissionState } from './types'

export function applyCommissionEvent(
  state: CommissionState,
  event: CommissionEvent,
  meta: EventMeta,
): CommissionState {
  const base = { ...state, _version: meta.version }

  switch (event._tag) {
    case 'commission.created':
      return { ...base, ...event.data }
    case 'commission.updated':
      return { ...base, ...event.changes }
    case 'commission.deleted':
      return base
  }
}
