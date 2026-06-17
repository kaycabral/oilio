import type { AggregateConfig } from '@/domain/effect/event-store'
import { MembershipEventSchema, type MembershipEvent } from './events'
import { applyMembershipEvent } from './reducer'
import { INITIAL_MEMBERSHIP_STATE, type MembershipState } from './types'

export const MembershipConfig: AggregateConfig<MembershipState, MembershipEvent> = {
  type: 'membership',
  initialState: INITIAL_MEMBERSHIP_STATE,
  reducer: applyMembershipEvent,
  schema: MembershipEventSchema,
  currentSchemaVersion: 1,
}
