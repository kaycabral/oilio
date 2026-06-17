import type { AggregateConfig } from '@/domain/effect/event-store'
import { CategoryEventSchema, type CategoryEvent } from './events'
import { applyCategoryEvent } from './reducer'
import { INITIAL_CATEGORY_STATE, type CategoryState } from './types'

export const CategoryConfig: AggregateConfig<CategoryState, CategoryEvent> = {
  type: 'category',
  initialState: INITIAL_CATEGORY_STATE,
  reducer: applyCategoryEvent,
  schema: CategoryEventSchema,
  currentSchemaVersion: 1,
}
