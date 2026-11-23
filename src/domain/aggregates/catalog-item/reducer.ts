import type { EventMeta } from '@/domain/effect/event-store'
import type { CatalogItemEvent } from './events'
import type { CatalogItemState } from './types'

export function applyCatalogItemEvent(
  state: CatalogItemState,
  event: CatalogItemEvent,
  meta: EventMeta,
): CatalogItemState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'catalog_item.created':
      return Object.assign({ ...base }, event.data, {
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      })
    case 'catalog_item.updated':
      return Object.assign({ ...base }, event.changes, { updatedAt: meta.timestamp })
    case 'catalog_item.archived':
      return { ...base, archivedAt: event.archivedAt }
    case 'catalog_item.deleted':
      return base
  }
}
