import type { EventMeta } from '@/domain/effect/event-store'
import type { GoalEvent } from './events'
import type { GoalState } from './types'

export function applyGoalEvent(state: GoalState, event: GoalEvent, meta: EventMeta): GoalState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  if (event._tag === 'goal.defined') {
    return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
  }
  return { ...base, ...event.changes, updatedAt: meta.timestamp }
}
