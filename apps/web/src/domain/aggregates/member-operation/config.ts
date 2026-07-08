import type { AggregateConfig } from '@/domain/effect/event-store'
import { MemberOperationEventSchema, type MemberOperationEvent } from './events'
import { applyMemberOperationEvent } from './reducer'
import { INITIAL_MEMBER_OPERATION_STATE, type MemberOperationState } from './types'

export const MemberOperationConfig: AggregateConfig<MemberOperationState, MemberOperationEvent> = {
  type: 'member_operation',
  initialState: INITIAL_MEMBER_OPERATION_STATE,
  reducer: applyMemberOperationEvent,
  schema: MemberOperationEventSchema,
  // Stays 1 through the memberOperation service-FK field rename (B2 / brief 0052)
  // with no upcaster. NOTE: oilio runs in production — the earlier "pre-prod, re-seed"
  // rationale here was stale (audit #1383). The version is nonetheless correct because
  // production holds ZERO persisted member_operation events (verified 2026-07-08 against
  // the prod `oilio` DB: `count(*) where aggregate_type='member_operation'` = 0), so the
  // rename drops no historical key. This is validated, NOT assumed-empty.
  //
  // The moment the FIRST member_operation event is persisted, this invariant flips: any
  // further persisted-field rename MUST bump the version and register an upcaster mapping
  // the legacy key on historical member_operation.created.data / member_operation.updated.changes,
  // otherwise replay silently drops the renamed key (Effect decodes with onExcessProperty='ignore').
  currentSchemaVersion: 1,
}
