import { Commission, CommissionFields } from '@/domain/types/commission'
import { Schema } from 'effect'

export const CommissionCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('commission.created'),
  data: Commission,
})

export const CommissionUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('commission.updated'),
  changes: Schema.partial(CommissionFields),
})

export const CommissionDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('commission.deleted'),
})

export const CommissionEventSchema = Schema.Union(
  CommissionCreatedSchema,
  CommissionUpdatedSchema,
  CommissionDeletedSchema,
)

export type CommissionCreated = typeof CommissionCreatedSchema.Type
export type CommissionUpdated = typeof CommissionUpdatedSchema.Type
export type CommissionDeleted = typeof CommissionDeletedSchema.Type
export type CommissionEvent = typeof CommissionEventSchema.Type
