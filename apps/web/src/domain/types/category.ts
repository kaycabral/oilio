import { Schema } from 'effect'

// Catalog category as a first-class entity (brief 0023, AC-03). Replaces the
// free-text category string previously carried inline on items/plans with a
// stable, per-tenant referenceable doc. `CatalogItem.categoryId` and
// `SubscriptionPlan.includedCategoryIds` are FKs into this entity (#1003).
//
// Stored at `tenants/{tenantId}/categories/{id}`.
export const Category = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    name: Schema.String,
    // Optional visual cues for the catalog UI (#1005 will consume these).
    // `null` when unset — kept explicit (never `undefined`) because the
    // Firestore Admin SDK rejects `undefined` on writes.
    icon: Schema.NullOr(Schema.String),
    color: Schema.NullOr(Schema.String),
    // Active categories show up in pickers; inactive ones are hidden from new
    // selections but stay resolvable so historical items/plans keep their label.
    active: Schema.Boolean,
    // Uniform delete policy (brief 0027, AC-06). A referenced category can't be
    // hard-deleted — it's archived instead (`archivedAt` set to an ISO timestamp).
    // Archived entities drop out of active pickers/management tables but stay
    // resolvable for historical references. `null` = active (not archived).
    archivedAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Category = typeof Category.Type

export const CATEGORY_NAME_MIN = 2
export const CATEGORY_NAME_MAX = 40
