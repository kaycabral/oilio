import type { EventMeta } from '@/domain/effect/event-store'
import type { CashMovementEvent } from './events'
import type { CashMovementState } from './types'

export function applyCashMovementEvent(
  _state: CashMovementState,
  event: CashMovementEvent,
  meta: EventMeta,
): CashMovementState {
  // Append-only: o único evento materializa o doc inteiro; não há transição.
  switch (event._tag) {
    case 'cash_movement.created':
      return { ...event.data, _version: meta.version }
  }
}
