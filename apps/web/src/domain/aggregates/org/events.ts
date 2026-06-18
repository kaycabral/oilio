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

export const OrgSelfBookingPublishedSchema = Schema.Struct({
  _tag: Schema.Literal('org.self_booking_published'),
})

export const OrgSelfBookingUnpublishedSchema = Schema.Struct({
  _tag: Schema.Literal('org.self_booking_unpublished'),
})

export const OrgEventSchema = Schema.Union(
  OrgCreatedSchema,
  OrgUpdatedSchema,
  OrgDeletedSchema,
  OrgSelfBookingPublishedSchema,
  OrgSelfBookingUnpublishedSchema,
)

export type OrgCreated = typeof OrgCreatedSchema.Type
export type OrgUpdated = typeof OrgUpdatedSchema.Type
export type OrgDeleted = typeof OrgDeletedSchema.Type
export type OrgSelfBookingPublished = typeof OrgSelfBookingPublishedSchema.Type
export type OrgSelfBookingUnpublished = typeof OrgSelfBookingUnpublishedSchema.Type
export type OrgEvent = typeof OrgEventSchema.Type
