import { Category } from '@/domain/types/category'
import { Schema, Struct } from 'effect'

export const CategoryCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('category.created'),
  data: Category,
})

export const CategoryUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('category.updated'),
  changes: Category.mapFields(Struct.map(Schema.optional)),
})

export const CategoryDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('category.deleted'),
})

export const CategoryArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('category.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const CategoryEventSchema = Schema.Union([
  CategoryCreatedSchema,
  CategoryUpdatedSchema,
  CategoryDeletedSchema,
  CategoryArchivedSchema,
])

export type CategoryCreated = typeof CategoryCreatedSchema.Type
export type CategoryUpdated = typeof CategoryUpdatedSchema.Type
export type CategoryDeleted = typeof CategoryDeletedSchema.Type
export type CategoryArchived = typeof CategoryArchivedSchema.Type
export type CategoryEvent = typeof CategoryEventSchema.Type
