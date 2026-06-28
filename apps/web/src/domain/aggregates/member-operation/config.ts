import type { AggregateConfig } from '@/domain/effect/event-store'
import { MemberOperationEventSchema, type MemberOperationEvent } from './events'
import { applyMemberOperationEvent } from './reducer'
import { INITIAL_MEMBER_OPERATION_STATE, type MemberOperationState } from './types'

export const MemberOperationConfig: AggregateConfig<MemberOperationState, MemberOperationEvent> = {
  type: 'member_operation',
  initialState: INITIAL_MEMBER_OPERATION_STATE,
  reducer: applyMemberOperationEvent,
  schema: MemberOperationEventSchema,
  // Stays 1 despite the memberOperation service-FK field rename (B2 / brief 0052):
  // no upcaster ships because Onda 1 assumes RE-SEED — oilio is pre-prod with no
  // persisted memberOperation events (PRD § "Migração de dado histórico"). If oilio
  // ever gains production data, a field rename like this MUST bump the version
  // and register an upcaster mapping the legacy key on historical
  // member_operation.created.data / member_operation.updated.changes — otherwise replay
  // silently drops the link (Effect decodes with onExcessProperty='ignore').
  currentSchemaVersion: 1,
}
