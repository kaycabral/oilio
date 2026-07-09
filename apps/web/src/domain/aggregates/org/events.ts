import { StoredOrg } from '@/domain/types/org'
import { Schema } from 'effect'

export const OrgCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('org.created'),
  data: StoredOrg,
})

export const OrgUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('org.updated'),
  changes: Schema.partial(StoredOrg),
})

export const OrgDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('org.deleted'),
})

export const OrgEventSchema = Schema.Union(OrgCreatedSchema, OrgUpdatedSchema, OrgDeletedSchema)

export type OrgCreated = typeof OrgCreatedSchema.Type
export type OrgUpdated = typeof OrgUpdatedSchema.Type
export type OrgDeleted = typeof OrgDeletedSchema.Type
export type OrgEvent = typeof OrgEventSchema.Type
