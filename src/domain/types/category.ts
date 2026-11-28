import { Schema, Struct } from 'effect'

export const Category = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type Category = typeof Category.Type

export const CATEGORY_NAME_MIN = 2
export const CATEGORY_NAME_MAX = 40
