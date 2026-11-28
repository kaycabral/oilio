import { NonEmptyString } from '@/domain/value-objects'
import { Schema, Struct } from 'effect'

const PositiveIntCents = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))

export const FIXED_COST_CATEGORIES = [
  'expense_commercial',
  'expense_admin',
  'expense_financial',
] as const
export const FixedCostCategory = Schema.Literals(FIXED_COST_CATEGORIES)
export type FixedCostCategory = typeof FixedCostCategory.Type

const FIXED_COST_CATEGORY_SET = new Set<string>(FIXED_COST_CATEGORIES)

export function isFixedCostCategory(value: string): value is FixedCostCategory {
  return FIXED_COST_CATEGORY_SET.has(value)
}

export const FIXED_COST_DEFAULT_CATEGORY: FixedCostCategory = 'expense_admin'

export const FixedCost = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  seriesId: Schema.String,
  name: NonEmptyString,
  category: FixedCostCategory,
  amountCents: PositiveIntCents,
  effectiveFrom: Schema.String,
  effectiveTo: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type FixedCost = typeof FixedCost.Type

export const FixedCostOverride = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  seriesId: Schema.String,
  month: Schema.String,
  amountCents: PositiveIntCents,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type FixedCostOverride = typeof FixedCostOverride.Type

export const FIXED_COST_NAME_MIN = 2
export const FIXED_COST_NAME_MAX = 60
