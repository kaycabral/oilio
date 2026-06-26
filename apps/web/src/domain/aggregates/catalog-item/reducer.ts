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
      // `data` is the full `CatalogItem` (a discriminated union). Layering it
      // over `base` with `Object.assign` keeps the result a `CatalogItemState`
      // (initial-state defaults preserved, discriminant carried from `data`),
      // where a plain object-literal spread would widen the union and lose
      // narrowing.
      return Object.assign({ ...base }, event.data, {
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      })
    case 'catalog_item.updated':
      // `changes` is a partial over the `CatalogItem` union; merging it onto the
      // typed accumulator with `Object.assign` keeps the result a
      // `CatalogItemState` (the discriminant carries over from `state`).
      return Object.assign({ ...base }, event.changes, { updatedAt: meta.timestamp })
    case 'catalog_item.archived':
      return { ...base, archivedAt: event.archivedAt }
    case 'catalog_item.deleted':
      return base
  }
}
