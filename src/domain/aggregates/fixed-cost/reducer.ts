import type { EventMeta } from '@/domain/effect/event-store'
import type { FixedCostEvent } from './events'
import type { FixedCostState } from './types'

export function applyFixedCostEvent(
  state: FixedCostState,
  event: FixedCostEvent,
  meta: EventMeta,
): FixedCostState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'fixed_cost.created':
      return {
        ...base,
        ...event.data,
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      }
    case 'fixed_cost.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'fixed_cost.superseded':
      return { ...base, effectiveTo: event.effectiveTo }
    case 'fixed_cost.archived':
      return { ...base, archivedAt: event.archivedAt }
  }
}
