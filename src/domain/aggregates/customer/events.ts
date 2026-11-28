import { StoredCustomer } from '@/domain/types/customer'
import { Schema, Struct } from 'effect'

export const CustomerCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('customer.created'),
  data: StoredCustomer,
})

export const CustomerUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('customer.updated'),
  changes: StoredCustomer.mapFields(Struct.map(Schema.optional)),
})

export const CustomerDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('customer.deleted'),
})

export const CustomerEventSchema = Schema.Union([
  CustomerCreatedSchema,
  CustomerUpdatedSchema,
  CustomerDeletedSchema,
])

export type CustomerCreated = typeof CustomerCreatedSchema.Type
export type CustomerUpdated = typeof CustomerUpdatedSchema.Type
export type CustomerDeleted = typeof CustomerDeletedSchema.Type
export type CustomerEvent = typeof CustomerEventSchema.Type
