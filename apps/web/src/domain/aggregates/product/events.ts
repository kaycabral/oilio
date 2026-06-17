import { Product } from '@/domain/types/product'
import { Schema } from 'effect'

export const ProductCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('product.created'),
  data: Product,
})

export const ProductUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('product.updated'),
  changes: Schema.partial(Product),
})

export const ProductDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('product.deleted'),
})

export const ProductEventSchema = Schema.Union(
  ProductCreatedSchema,
  ProductUpdatedSchema,
  ProductDeletedSchema,
)

export type ProductCreated = typeof ProductCreatedSchema.Type
export type ProductUpdated = typeof ProductUpdatedSchema.Type
export type ProductDeleted = typeof ProductDeletedSchema.Type
export type ProductEvent = typeof ProductEventSchema.Type
