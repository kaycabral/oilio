import type { EventMeta } from '@/domain/effect/event-store'
import type { CategoryEvent } from './events'
import type { CategoryState } from './types'

export function applyCategoryEvent(
  state: CategoryState,
  event: CategoryEvent,
  meta: EventMeta,
): CategoryState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'category.created':
      return {
        ...base,
        ...event.data,
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      }
    case 'category.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'category.archived':
      return { ...base, archivedAt: event.archivedAt }
    case 'category.deleted':
      return base
  }
}
