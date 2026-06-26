import type { AggregateConfig } from '@/domain/effect/event-store'
import { MembershipEventSchema, type MembershipEvent } from './events'
import { applyMembershipEvent } from './reducer'
import { INITIAL_MEMBERSHIP_STATE, type MembershipState } from './types'

// The membership event schema decode-normalizes the legacy `unitId` wire key
// onto `rlsUnitScope` (brief 0068 D4), so its Encoded type differs from
// `MembershipEvent`. Derive the Encoded from the schema so the config stays
// type-accurate (the third `AggregateConfig` type param).
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
