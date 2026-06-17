import { StoredTenant } from '@/domain/types/tenant'
import { Schema } from 'effect'

export const TenantCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('tenant.created'),
  data: StoredTenant,
})

export const TenantUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('tenant.updated'),
  changes: Schema.partial(StoredTenant),
})

export const TenantDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('tenant.deleted'),
})

export const TenantSelfBookingPublishedSchema = Schema.Struct({
  _tag: Schema.Literal('tenant.self_booking_published'),
})

export const TenantSelfBookingUnpublishedSchema = Schema.Struct({
  _tag: Schema.Literal('tenant.self_booking_unpublished'),
})

export const TenantEventSchema = Schema.Union(
  TenantCreatedSchema,
  TenantUpdatedSchema,
  TenantDeletedSchema,
  TenantSelfBookingPublishedSchema,
  TenantSelfBookingUnpublishedSchema,
)

export type TenantCreated = typeof TenantCreatedSchema.Type
export type TenantUpdated = typeof TenantUpdatedSchema.Type
export type TenantDeleted = typeof TenantDeletedSchema.Type
export type TenantSelfBookingPublished = typeof TenantSelfBookingPublishedSchema.Type
export type TenantSelfBookingUnpublished = typeof TenantSelfBookingUnpublishedSchema.Type
export type TenantEvent = typeof TenantEventSchema.Type
