import type { AggregateConfig } from '@/domain/effect/event-store'
import { TenantEventSchema, type TenantEvent } from './events'
import { applyTenantEvent } from './reducer'
import { INITIAL_TENANT_STATE, type TenantState } from './types'

export const TenantConfig: AggregateConfig<TenantState, TenantEvent> = {
  type: 'tenant',
  initialState: INITIAL_TENANT_STATE,
  reducer: applyTenantEvent,
  schema: TenantEventSchema,
  currentSchemaVersion: 1,
}
