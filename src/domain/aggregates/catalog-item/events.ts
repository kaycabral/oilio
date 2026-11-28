import { CatalogItem, CatalogItemChanges } from '@/domain/types/catalog-item'
import { Schema } from 'effect'

const UnitScopedCatalogItem = CatalogItem.pipe(
  Schema.check(
    Schema.makeFilter((item) => item.unitIds.length > 0, {
      identifier: 'UnitScopedCatalogItem',
      message: 'a catalog item must be scoped to at least one unit',
    }),
  ),
)

const UnitScopedCatalogItemChanges = CatalogItemChanges.pipe(
  Schema.check(
    Schema.makeFilter((changes) => changes.unitIds === undefined || changes.unitIds.length > 0, {
      identifier: 'UnitScopedCatalogItemChanges',
      message: 'a catalog item update cannot clear its unit scope',
    }),
  ),
)

export const CatalogItemCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.created'),
  data: UnitScopedCatalogItem,
})

export const CatalogItemUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.updated'),
  changes: UnitScopedCatalogItemChanges,
})

export const CatalogItemDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.deleted'),
})

export const CatalogItemArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('catalog_item.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const CatalogItemEventSchema = Schema.Union([
  CatalogItemCreatedSchema,
  CatalogItemUpdatedSchema,
  CatalogItemDeletedSchema,
  CatalogItemArchivedSchema,
])

export type CatalogItemCreated = typeof CatalogItemCreatedSchema.Type
export type CatalogItemUpdated = typeof CatalogItemUpdatedSchema.Type
export type CatalogItemDeleted = typeof CatalogItemDeletedSchema.Type
export type CatalogItemArchived = typeof CatalogItemArchivedSchema.Type
export type CatalogItemEvent = typeof CatalogItemEventSchema.Type
