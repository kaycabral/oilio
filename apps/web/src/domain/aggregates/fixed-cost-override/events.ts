import { FixedCostOverride } from '@/domain/types/fixed-cost'
import { Schema } from 'effect'

export const FixedCostOverrideSetSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost_override.set'),
  data: FixedCostOverride,
})

export const FixedCostOverrideUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('fixed_cost_override.updated'),
  changes: Schema.partial(FixedCostOverride),
})

export const FixedCostOverrideEventSchema = Schema.Union(
  FixedCostOverrideSetSchema,
  FixedCostOverrideUpdatedSchema,
)

export type FixedCostOverrideSet = typeof FixedCostOverrideSetSchema.Type
export type FixedCostOverrideUpdated = typeof FixedCostOverrideUpdatedSchema.Type
export type FixedCostOverrideEvent = typeof FixedCostOverrideEventSchema.Type
