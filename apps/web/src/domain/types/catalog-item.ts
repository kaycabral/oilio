import { Schema } from 'effect'

import type { Product } from './product'
import { CommissionRule } from './professional'
import {
  type Service,
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
  tenantId: Schema.String,
  name: Schema.String,
  // Plain category id string for now — Category becomes a real entity in
  // #1003, at which point this stays a string FK (no shape change expected).
  // `null` when the item is uncategorized.
  categoryId: Schema.NullOr(Schema.String),
  // Base price (cents) used unless overridden per unit.
  priceCents: Schema.Number,
  // Commission rule snapshot template. `null` = no commission (common for
  // products in some tenants).
  commission: Schema.NullOr(CommissionRule),
  // Where the item is offered/sold. Non-empty for bookable services; products
  // may be sold tenant-wide but still carry their unit scope explicitly.
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

// ── Consumer adapters (brief 0023, #1004) ────────────────────────────────────
//
// The consumer migration points agenda/booking/order/public surfaces at the
// unified `catalog_items` collection instead of the legacy `services` one. The
// commercial/override semantics are identical to `Service` (same per-unit
// override stack), so these adapters keep the existing pure pipelines
// (`resolveServiceForUnit`, `computeAvailabilityForDay`, `toPublicService`)
// working unchanged — a consumer reads a `CatalogServiceItem`, adapts it to the
// legacy `Service` shape, and feeds the established flow. The booking snapshot
// fields (price/duration/commission) come out byte-for-byte the same.

// Returns the effective (post-override) commercial attributes for a catalog
// item at a given unit. Mirrors `resolveServiceForUnit` — pure, safe anywhere
// (booking snapshot, order finalization, agenda duration math). Works for both
// kinds; products carry `durationMinutes: 0` (the field is service-only on the
// union, so this only reads the override when present).
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

// Adapts a `CatalogServiceItem` to the legacy `Service` shape so consumers can
// keep feeding the existing service pipelines without re-plumbing every pure
// helper. The only field difference is `category` (legacy free-text label) vs
// `categoryId` (FK) — the FK is carried through as the label here; #1005
// resolves the human name. Identity (id/name/snapshots) is preserved exactly.
export function catalogServiceToService(item: CatalogServiceItem): Service {
  return {
    id: item.id,
    tenantId: item.tenantId,
    name: item.name,
    category: item.categoryId,
    durationMinutes: item.durationMinutes,
    priceCents: item.priceCents,
    commission: item.commission,
    requiredResources: item.requiredResources,
    active: item.active,
    publicVisible: item.publicVisible,
    priceVisibility: item.priceVisibility,
    unitIds: item.unitIds,
    unitOverrides: item.unitOverrides,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

// Adapts a `CatalogProductItem` to the legacy `Product` shape — symmetric with
// `catalogServiceToService`. Lets product pickers keep their existing prop
// types during the consumer migration (brief 0023, #1004).
export function catalogProductToProduct(item: CatalogProductItem): Product {
  return {
    id: item.id,
    tenantId: item.tenantId,
    name: item.name,
    sku: item.sku,
    priceCents: item.priceCents,
    stock: item.stock,
    active: item.active,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

// Sanitized projection of a `CatalogItem` for the public catalog (brief 0023,
// AC-08). Supersedes `PublicService`: projects BOTH kinds discriminated by
// `kind`, dropping commission/unitOverrides/active/publicVisible/tenantId.
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
