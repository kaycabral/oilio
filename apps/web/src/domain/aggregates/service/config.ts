import type { AggregateConfig } from '@/domain/effect/event-store'
import { ServiceEventSchema, type ServiceEvent } from './events'
import { applyServiceEvent } from './reducer'
import { INITIAL_SERVICE_STATE, type ServiceState } from './types'

export const ServiceConfig: AggregateConfig<ServiceState, ServiceEvent> = {
  type: 'service',
  initialState: INITIAL_SERVICE_STATE,
  reducer: applyServiceEvent,
  schema: ServiceEventSchema,
  currentSchemaVersion: 1,
}
