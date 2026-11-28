import { StoredInvite, StoredInviteFields } from '@/domain/types/invite'
import { Schema, Struct } from 'effect'

export const InviteCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('invite.created'),
  data: StoredInvite,
})

export const InviteUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('invite.updated'),
  changes: StoredInviteFields.mapFields(Struct.map(Schema.optional)),
})

export const InviteDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('invite.deleted'),
})

export const InviteEventSchema = Schema.Union([
  InviteCreatedSchema,
  InviteUpdatedSchema,
  InviteDeletedSchema,
])

export type InviteCreated = typeof InviteCreatedSchema.Type
export type InviteUpdated = typeof InviteUpdatedSchema.Type
export type InviteDeleted = typeof InviteDeletedSchema.Type
export type InviteEvent = typeof InviteEventSchema.Type
