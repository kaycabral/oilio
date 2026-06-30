import { CatalogItem, CatalogItemChanges } from '@/domain/types/catalog-item'
import { Schema } from 'effect'

// The non-empty-`unitIds` invariant (#1283) lives at the EVENT boundary, not the
// base `CatalogItem` type (whose reducer INITIAL state carries the empty
// zero-value transiently — see `types/catalog-item.ts`). A `catalog_item.created`
// payload must scope the item to ≥1 unit; a phantom item (no unit) is refused at
// `appendEvent` decode, fail-fast before the `catalog_items_unit_ids_nonempty`
// DB CHECK.
const UnitScopedCatalogItem = CatalogItem.pipe(
  Schema.filter((item) => item.unitIds.length > 0, {
    identifier: 'UnitScopedCatalogItem',
    message: () => 'a catalog item must be scoped to at least one unit',
  }),
)

// An `updated` patch may omit `unitIds`; when present it must stay non-empty
// (shrinking the scope to zero would orphan the item from every unit).
const UnitScopedCatalogItemChanges = CatalogItemChanges.pipe(
  Schema.filter((changes) => changes.unitIds === undefined || changes.unitIds.length > 0, {
    identifier: 'UnitScopedCatalogItemChanges',
    message: () => 'a catalog item update cannot clear its unit scope',
  }),
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
