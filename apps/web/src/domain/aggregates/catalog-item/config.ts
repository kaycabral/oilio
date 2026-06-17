import type { AggregateConfig } from '@/domain/effect/event-store'
import { CatalogItemEventSchema, type CatalogItemEvent } from './events'
import { applyCatalogItemEvent } from './reducer'
import { INITIAL_CATALOG_ITEM_STATE, type CatalogItemState } from './types'

export const CatalogItemConfig: AggregateConfig<CatalogItemState, CatalogItemEvent> = {
  type: 'catalog_item',
  initialState: INITIAL_CATALOG_ITEM_STATE,
  reducer: applyCatalogItemEvent,
  schema: CatalogItemEventSchema,
  currentSchemaVersion: 1,
}
