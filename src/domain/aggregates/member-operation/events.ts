import { StoredMemberOperation } from '@/domain/types/member-operation'
import { Schema, Struct } from 'effect'

export const MemberOperationCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.created'),
  data: StoredMemberOperation,
})

export const MemberOperationUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.updated'),
  changes: StoredMemberOperation.mapFields(Struct.map(Schema.optional)),
})

export const MemberOperationDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.deleted'),
})

export const MemberOperationActivatedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.activated'),
})

export const MemberOperationSuspendedSchema = Schema.Struct({
  _tag: Schema.Literal('member_operation.suspended'),
})

export const MemberOperationEventSchema = Schema.Union([
  MemberOperationCreatedSchema,
  MemberOperationUpdatedSchema,
  MemberOperationDeletedSchema,
  MemberOperationActivatedSchema,
  MemberOperationSuspendedSchema,
])

export type MemberOperationCreated = typeof MemberOperationCreatedSchema.Type
export type MemberOperationUpdated = typeof MemberOperationUpdatedSchema.Type
export type MemberOperationDeleted = typeof MemberOperationDeletedSchema.Type
export type MemberOperationActivated = typeof MemberOperationActivatedSchema.Type
export type MemberOperationSuspended = typeof MemberOperationSuspendedSchema.Type
export type MemberOperationEvent = typeof MemberOperationEventSchema.Type
