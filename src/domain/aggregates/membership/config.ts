import type { AggregateConfig } from '@/domain/effect/event-store'
import { MembershipEventSchema, type MembershipEvent } from './events'
import { applyMembershipEvent } from './reducer'
import { INITIAL_MEMBERSHIP_STATE, type MembershipState } from './types'

type MembershipEventEncoded = typeof MembershipEventSchema.Encoded

export const MembershipConfig: AggregateConfig<
  MembershipState,
  MembershipEvent,
  MembershipEventEncoded
> = {
  type: 'membership',
  initialState: INITIAL_MEMBERSHIP_STATE,
  reducer: applyMembershipEvent,
  schema: MembershipEventSchema,
  currentSchemaVersion: 1,
}
