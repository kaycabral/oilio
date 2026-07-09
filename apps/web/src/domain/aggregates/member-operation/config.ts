import type { AggregateConfig } from '@/domain/effect/event-store'
import { MemberOperationEventSchema, type MemberOperationEvent } from './events'
import { applyMemberOperationEvent } from './reducer'
import { INITIAL_MEMBER_OPERATION_STATE, type MemberOperationState } from './types'

export const MemberOperationConfig: AggregateConfig<MemberOperationState, MemberOperationEvent> = {
  type: 'member_operation',
  initialState: INITIAL_MEMBER_OPERATION_STATE,
  reducer: applyMemberOperationEvent,
  schema: MemberOperationEventSchema,
  currentSchemaVersion: 1,
}
