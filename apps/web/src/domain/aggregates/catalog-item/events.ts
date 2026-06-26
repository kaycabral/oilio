import { CatalogItem, CatalogItemChanges } from '@/domain/types/catalog-item'
import { Schema } from 'effect'

export const CatalogItemCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.created'),
  data: CatalogItem,
})

export const CatalogItemUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.updated'),
  changes: CatalogItemChanges,
})

export const CatalogItemDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.deleted'),
})

export const CatalogItemArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const CatalogItemEventSchema = Schema.Union(
  CatalogItemCreatedSchema,
  CatalogItemUpdatedSchema,
  CatalogItemDeletedSchema,
  CatalogItemArchivedSchema,
)

export type CatalogItemCreated = typeof CatalogItemCreatedSchema.Type
export type CatalogItemUpdated = typeof CatalogItemUpdatedSchema.Type
export type CatalogItemDeleted = typeof CatalogItemDeletedSchema.Type
export type CatalogItemArchived = typeof CatalogItemArchivedSchema.Type
export type CatalogItemEvent = typeof CatalogItemEventSchema.Type
