import { Schema, Struct } from 'effect'

export const ExpenseCategory = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  archived: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type ExpenseCategory = typeof ExpenseCategory.Type

export const EXPENSE_CATEGORY_NAME_MIN = 2
export const EXPENSE_CATEGORY_NAME_MAX = 40
