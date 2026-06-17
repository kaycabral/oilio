import { Service } from '@/domain/types/service'
import { Schema } from 'effect'

export const ServiceCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('service.created'),
  data: Service,
})

export const ServiceUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('service.updated'),
  changes: Schema.partial(Service),
})

export const ServiceDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('service.deleted'),
})

export const ServiceEventSchema = Schema.Union(
  ServiceCreatedSchema,
  ServiceUpdatedSchema,
  ServiceDeletedSchema,
)

export type ServiceCreated = typeof ServiceCreatedSchema.Type
export type ServiceUpdated = typeof ServiceUpdatedSchema.Type
export type ServiceDeleted = typeof ServiceDeletedSchema.Type
export type ServiceEvent = typeof ServiceEventSchema.Type
