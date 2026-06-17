import type { AggregateConfig } from '@/domain/effect/event-store'
import { ProductEventSchema, type ProductEvent } from './events'
import { applyProductEvent } from './reducer'
import { INITIAL_PRODUCT_STATE, type ProductState } from './types'

export const ProductConfig: AggregateConfig<ProductState, ProductEvent> = {
  type: 'product',
  initialState: INITIAL_PRODUCT_STATE,
  reducer: applyProductEvent,
  schema: ProductEventSchema,
  currentSchemaVersion: 1,
}
