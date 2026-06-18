import { Schema } from 'effect'

export const Product = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    name: Schema.String,
    sku: Schema.NullOr(Schema.String),
    priceCents: Schema.Number,
    stock: Schema.Number,
    active: Schema.Boolean,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Product = typeof Product.Type
