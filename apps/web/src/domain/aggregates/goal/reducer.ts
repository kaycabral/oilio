import type { EventMeta } from '@/domain/effect/event-store'
import type { GoalEvent } from './events'
import type { GoalState } from './types'

export function applyGoalEvent(state: GoalState, event: GoalEvent, meta: EventMeta): GoalState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  // Exhaustive over GoalEvent (defined | updated) — no `default` branch so the
  // reducer stays fully covered (every path is reachable). Schema validation
  // upstream (appendEvent) guarantees only these tags reach the reducer.
  if (event._tag === 'goal.defined') {
    return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
  }
  return { ...base, ...event.changes, updatedAt: meta.timestamp }
}
