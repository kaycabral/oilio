import { StoredMemberOperation } from '@/domain/types/member-operation'
import { Schema } from 'effect'

export const MemberOperationCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.created'),
  data: StoredMemberOperation,
})

export const MemberOperationUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.updated'),
  changes: Schema.partial(StoredMemberOperation),
})

export const MemberOperationDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.deleted'),
})

// Operational-readiness transitions. No longer EMITTED (#1226 AC-02 — the status
// is derived on read, not materialized), but retained in the event union so
// HISTORICAL streams that emitted them still decode and replay (the reducer
// treats them as no-ops).
export const MemberOperationActivatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.activated'),
})

export const MemberOperationSuspendedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.suspended'),
})

export const MemberOperationEventSchema = Schema.Union(
  MemberOperationCreatedSchema,
  MemberOperationUpdatedSchema,
  MemberOperationDeletedSchema,
  MemberOperationActivatedSchema,
  MemberOperationSuspendedSchema,
)

export type MemberOperationCreated = typeof MemberOperationCreatedSchema.Type
export type MemberOperationUpdated = typeof MemberOperationUpdatedSchema.Type
export type MemberOperationDeleted = typeof MemberOperationDeletedSchema.Type
export type MemberOperationActivated = typeof MemberOperationActivatedSchema.Type
export type MemberOperationSuspended = typeof MemberOperationSuspendedSchema.Type
export type MemberOperationEvent = typeof MemberOperationEventSchema.Type
