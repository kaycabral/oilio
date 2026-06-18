import type { AggregateConfig } from '@/domain/effect/event-store'
import { OrgEventSchema, type OrgEvent } from './events'
import { applyOrgEvent } from './reducer'
import { INITIAL_ORG_STATE, type OrgState } from './types'

export const OrgConfig: AggregateConfig<OrgState, OrgEvent> = {
  type: 'org',
  initialState: INITIAL_ORG_STATE,
  reducer: applyOrgEvent,
  schema: OrgEventSchema,
  currentSchemaVersion: 1,
}
