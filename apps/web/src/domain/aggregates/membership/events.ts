import { Membership } from '@/domain/types/membership'
import { Schema } from 'effect'

export const MembershipCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.created'),
  data: Membership,
})

export const MembershipUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.updated'),
  changes: Schema.partial(Membership),
})

export const MembershipDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.deleted'),
})

export const MembershipEventSchema = Schema.Union(
  MembershipCreatedSchema,
  MembershipUpdatedSchema,
  MembershipDeletedSchema,
)

export type MembershipCreated = typeof MembershipCreatedSchema.Type
export type MembershipUpdated = typeof MembershipUpdatedSchema.Type
export type MembershipDeleted = typeof MembershipDeletedSchema.Type
export type MembershipEvent = typeof MembershipEventSchema.Type
