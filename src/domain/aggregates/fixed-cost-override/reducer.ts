import type { EventMeta } from '@/domain/effect/event-store'
import type { FixedCostOverrideEvent } from './events'
import type { FixedCostOverrideState } from './types'

export function applyFixedCostOverrideEvent(
  state: FixedCostOverrideState,
  event: FixedCostOverrideEvent,
  meta: EventMeta,
): FixedCostOverrideState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'fixed_cost_override.set':
      return {
        ...base,
        ...event.data,
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      }
    case 'fixed_cost_override.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
  }
}
