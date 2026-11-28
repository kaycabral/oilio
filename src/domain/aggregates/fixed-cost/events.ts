import { FixedCost, FixedCostCategory } from '@/domain/types/fixed-cost'
import { NonEmptyString } from '@/domain/value-objects'
import { Schema, Struct } from 'effect'

export const FixedCostCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost.created'),
  data: FixedCost,
})

export const FixedCostUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost.updated'),
  changes: Schema.Struct({ name: NonEmptyString, category: FixedCostCategory }).mapFields(
    Struct.map(Schema.optionalKey),
  ),
})

export const FixedCostSupersededSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost.superseded'),
  effectiveTo: Schema.String,
})

export const FixedCostArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const FixedCostEventSchema = Schema.Union([
  FixedCostCreatedSchema,
  FixedCostUpdatedSchema,
  FixedCostSupersededSchema,
  FixedCostArchivedSchema,
])

export type FixedCostCreated = typeof FixedCostCreatedSchema.Type
export type FixedCostUpdated = typeof FixedCostUpdatedSchema.Type
export type FixedCostSuperseded = typeof FixedCostSupersededSchema.Type
export type FixedCostArchived = typeof FixedCostArchivedSchema.Type
export type FixedCostEvent = typeof FixedCostEventSchema.Type
