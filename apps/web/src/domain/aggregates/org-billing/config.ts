import type { AggregateConfig } from '@/domain/effect/event-store'
import { OrgBillingEventSchema, type OrgBillingEvent } from './events'
import { applyOrgBillingEvent } from './reducer'
import { INITIAL_ORG_BILLING_STATE, type OrgBillingState } from './types'

export const OrgBillingConfig: AggregateConfig<OrgBillingState, OrgBillingEvent> = {
  type: 'org_billing',
  initialState: INITIAL_ORG_BILLING_STATE,
  reducer: applyOrgBillingEvent,
  schema: OrgBillingEventSchema,
  currentSchemaVersion: 1,
}
