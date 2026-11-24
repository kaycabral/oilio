import type { EventMeta } from '@/domain/effect/event-store'
import type { ChargeEvent } from './events'
import type { ChargeState } from './types'

export function applyChargeEvent(
  state: ChargeState,
  event: ChargeEvent,
  meta: EventMeta,
): ChargeState {
  const base = { ...state, _version: meta.version }

  switch (event._tag) {
    case 'charge.created':
      return { ...base, ...event.data }
    case 'charge.succeeded':
    case 'charge.failed':
    case 'charge.cancelled':
    case 'charge.refunded':
      return { ...base, ...event.changes }
  }
}
