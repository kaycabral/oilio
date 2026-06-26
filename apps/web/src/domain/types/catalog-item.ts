import { Schema } from 'effect'

import { CommissionRule } from './professional'
import {
  ServicePriceVisibility,
  ServiceUnitOverride,
  normalizeServicePriceVisibility,
} from './service'

// Unified catalog entity (brief 0023, AC-01). Replaces the split between
// `Service` and `Product`: a single `catalog_items` collection discriminated
// by `kind`. Common commercial fields live on the base shape; kind-specific
// fields hang off the discriminated union so the type system enforces that a
// product never carries `durationMinutes` and a service never carries `stock`.
export const CATALOG_ITEM_KINDS = ['service', 'product'] as const
export const CatalogItemKind = Schema.Literal(...CATALOG_ITEM_KINDS)
export type CatalogItemKind = typeof CatalogItemKind.Type

// Re-export the per-unit override shape — unified items reuse the exact same
// override semantics as `Service` (price/duration/commission per unit). #1003
// will turn `categoryId` into a real FK; for now it's a plain id string (or
// null when uncategorized).
export const CatalogItemUnitOverride = ServiceUnitOverride
export type CatalogItemUnitOverride = typeof CatalogItemUnitOverride.Type

const CatalogItemBaseFields = {
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  // Plain category id string for now — Category becomes a real entity in
  // #1003, at which point this stays a string FK (no shape change expected).
  // `null` when the item is uncategorized.
  categoryId: Schema.NullOr(Schema.String),
  // Base price (cents) used unless overridden per unit.
  priceCents: Schema.Number,
  // Commission rule snapshot template. `null` = no commission (common for
  // products in some orgs).
  commission: Schema.NullOr(CommissionRule),
  // Where the item is offered/sold. Non-empty for bookable services; products
  // may be sold org-wide but still carry their unit scope explicitly.
  unitIds: Schema.mutable(Schema.Array(Schema.String)),
  unitOverrides: Schema.NullOr(
    Schema.mutable(Schema.Record({ key: Schema.String, value: CatalogItemUnitOverride })),
  ),
  // Public catalog (/[slug]) visibility + price rendering, mirroring Service.
  publicVisible: Schema.Boolean,
  priceVisibility: ServicePriceVisibility,
  active: Schema.Boolean,
  // Uniform delete policy (brief 0027, AC-06). A referenced item (a plan's
  // coverage includes it) can't be hard-deleted — it's archived instead
  // (`archivedAt` set to an ISO timestamp). Archived items drop out of active
  // catalog/pickers but stay resolvable for historical plans/orders. `null` =
  // active (not archived).
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

export const CatalogServiceItem = Schema.mutable(
  Schema.Struct({
    ...CatalogItemBaseFields,
    kind: Schema.Literal('service'),
    // Service-only commercial attributes.
    durationMinutes: Schema.Number,
    requiredResources: Schema.mutable(Schema.Array(Schema.String)),
  }),
)
export type CatalogServiceItem = typeof CatalogServiceItem.Type

export const CatalogProductItem = Schema.mutable(
  Schema.Struct({
    ...CatalogItemBaseFields,
    kind: Schema.Literal('product'),
    // Product-only inventory attributes.
    sku: Schema.NullOr(Schema.String),
    stock: Schema.Number,
    // Reference to the sovereign product base (@cbrl/product) by canonical
    // GTIN-14 (brief 0050, A2). A REFERENCE, not a copy: the item links to the
    // cross-org `Product` by key, invisible in the UX. `null` when the item has
    // no GTIN (own-manufactured/weighed) or the GTIN was rejected by validation.
    // The key is stored even when the base is unavailable, so reconciliation can
    // resolve it later (best-effort invariant).
    gtin14: Schema.NullOr(Schema.String),
    // Reconciliation marker (brief 0050, AC-06/AC-07). `true` when the item was
    // registered with a valid GTIN but the sovereign base was UNAVAILABLE at the
    // gate — the item is saved with its GTIN guarded and this flag set, and the
    // reconciliation cron reprocesses it when the base is back. Optional: absent
    // on the happy path (base reachable) and on every pre-A2 item. The cron
    // queries `where('reconciliationPending','==',true)`, which matches only the
    // deferred items — absent/false never match.
    reconciliationPending: Schema.optional(Schema.Boolean),
    // ISO timestamp of the last reconciliation attempt (the deferred gate, then
    // each cron pass). Optional — supports observability and a future backoff
    // without a schema change.
    reconciliationLastAttempt: Schema.optional(Schema.String),
  }),
)
export type CatalogProductItem = typeof CatalogProductItem.Type

export const CatalogItem = Schema.Union(CatalogServiceItem, CatalogProductItem)
export type CatalogItem = typeof CatalogItem.Type

// Flat partial over BOTH variants' fields — for an `updated` patch that may
// touch a field of either kind (e.g. a product's `stock`). A union-partial
// (`Schema.partial(CatalogItem)`) would match an arbitrary member when the
// `kind` discriminant is absent from the patch and silently drop the other
// variant's fields, so the patch schema flattens the field sets instead.
export const CatalogItemChanges = Schema.partial(
  Schema.Struct({
    ...CatalogItemBaseFields,
    kind: CatalogItemKind,
    durationMinutes: Schema.Number,
    requiredResources: Schema.mutable(Schema.Array(Schema.String)),
    sku: Schema.NullOr(Schema.String),
    stock: Schema.Number,
    gtin14: Schema.NullOr(Schema.String),
    reconciliationPending: Schema.Boolean,
    reconciliationLastAttempt: Schema.String,
  }),
)
export type CatalogItemChanges = typeof CatalogItemChanges.Type

export function isCatalogService(item: CatalogItem): item is CatalogServiceItem {
  return item.kind === 'service'
}

export function isCatalogProduct(item: CatalogItem): item is CatalogProductItem {
  return item.kind === 'product'
}

export function normalizeCatalogItemKind(value: unknown): CatalogItemKind {
  return value === 'product' ? 'product' : 'service'
}

// ── Consumer helpers (brief 0023, #1004 → 0053/B3) ───────────────────────────
//
// Agenda/booking/order/public surfaces operate directly on the unified
// `catalog_items` shape. Brief 0053 (B3) removed the legacy back-adapters that
// projected catalog items to the old split shapes — there is one representation
// of catalog now (the `no-legacy-catalog-symbols` guard enforces it).

// Returns the effective (post-override) commercial attributes for a catalog
// item at a given unit. Pure, safe anywhere (booking snapshot, order
// finalization, agenda duration math). Works for both kinds; products carry
// `durationMinutes: 0` (the field is service-only on the union, so this only
// reads the override when present).
export function resolveCatalogItemForUnit(
  item: CatalogItem,
  unitId: string,
): {
  priceCents: number
  durationMinutes: number
  commission: CommissionRule | null
} {
  const o = item.unitOverrides?.[unitId] ?? {}
  const baseDuration = isCatalogService(item) ? item.durationMinutes : 0
  return {
    priceCents: o.priceCents ?? item.priceCents,
    durationMinutes: o.durationMinutes ?? baseDuration,
    commission: o.commission !== undefined ? o.commission : item.commission,
  }
}

// Sanitized projection of a `CatalogItem` for the public catalog (brief 0023,
// AC-08). The single public projection (B3 removed the per-kind legacy one):
// projects BOTH kinds discriminated by `kind`, dropping
// commission/unitOverrides/active/publicVisible/orgId.
// `priceCents` is `null` when `priceVisibility === 'on_request'`. Services
// carry `durationMinutes` (resolved per unit); products carry `null`.
export const PublicCatalogItem = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    kind: CatalogItemKind,
    name: Schema.String,
    categoryId: Schema.NullOr(Schema.String),
    requiredResources: Schema.mutable(Schema.Array(Schema.String)),
    priceCents: Schema.NullOr(Schema.Number),
    durationMinutes: Schema.NullOr(Schema.Number),
  }),
)
export type PublicCatalogItem = typeof PublicCatalogItem.Type

export function toPublicCatalogItem(item: CatalogItem, unitId: string): PublicCatalogItem {
  const resolved = resolveCatalogItemForUnit(item, unitId)
  const priceVisibility = normalizeServicePriceVisibility(item.priceVisibility)
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    categoryId: item.categoryId,
    requiredResources: isCatalogService(item) ? item.requiredResources : [],
    priceCents: priceVisibility === 'on_request' ? null : resolved.priceCents,
    durationMinutes: isCatalogService(item) ? resolved.durationMinutes : null,
  }
}
