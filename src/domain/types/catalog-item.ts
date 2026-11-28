import { Schema, Struct } from 'effect'

import { NonNegativeInt } from '@/domain/value-objects'
import { CommissionRule } from './member-operation'
import {
  ServicePriceVisibility,
  ServiceUnitOverride,
  normalizeServicePriceVisibility,
} from './service'

export const CATALOG_ITEM_KINDS = ['service', 'product'] as const
export const CatalogItemKind = Schema.Literals(CATALOG_ITEM_KINDS)
export type CatalogItemKind = typeof CatalogItemKind.Type

export const CatalogItemUnitOverride = ServiceUnitOverride
export type CatalogItemUnitOverride = typeof CatalogItemUnitOverride.Type

const CatalogItemBaseFields = {
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  categoryId: Schema.NullOr(Schema.String),
  priceCents: NonNegativeInt,
  commission: Schema.NullOr(CommissionRule),
  unitIds: Schema.mutable(Schema.Array(Schema.String)),
  unitOverrides: Schema.NullOr(Schema.Record(Schema.String, CatalogItemUnitOverride)),
  publicVisible: Schema.Boolean,
  priceVisibility: ServicePriceVisibility,
  active: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

export const CatalogServiceItem = Schema.Struct({
  ...CatalogItemBaseFields,
  kind: Schema.Literal('service'),
  durationMinutes: NonNegativeInt,
  requiredResources: Schema.mutable(Schema.Array(Schema.String)),
}).mapFields(Struct.map(Schema.mutableKey))
export type CatalogServiceItem = typeof CatalogServiceItem.Type

export const CatalogProductItem = Schema.Struct({
  ...CatalogItemBaseFields,
  kind: Schema.Literal('product'),
  sku: Schema.NullOr(Schema.String),
  stock: Schema.Number,
  gtin14: Schema.NullOr(Schema.String),
  reconciliationPending: Schema.optional(Schema.Boolean),
  reconciliationLastAttempt: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type CatalogProductItem = typeof CatalogProductItem.Type

export const CatalogItem = Schema.Union([CatalogServiceItem, CatalogProductItem])
export type CatalogItem = typeof CatalogItem.Type

export const CatalogItemChanges = Schema.Struct({
  ...CatalogItemBaseFields,
  kind: CatalogItemKind,
  durationMinutes: NonNegativeInt,
  requiredResources: Schema.mutable(Schema.Array(Schema.String)),
  sku: Schema.NullOr(Schema.String),
  stock: Schema.Number,
  gtin14: Schema.NullOr(Schema.String),
  reconciliationPending: Schema.Boolean,
  reconciliationLastAttempt: Schema.String,
}).mapFields(Struct.map(Schema.optional))
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

export const PublicCatalogItem = Schema.Struct({
  id: Schema.String,
  kind: CatalogItemKind,
  name: Schema.String,
  categoryId: Schema.NullOr(Schema.String),
  categoryName: Schema.NullOr(Schema.String),
  requiredResources: Schema.mutable(Schema.Array(Schema.String)),
  priceCents: Schema.NullOr(Schema.Number),
  durationMinutes: Schema.NullOr(Schema.Number),
}).mapFields(Struct.map(Schema.mutableKey))
export type PublicCatalogItem = typeof PublicCatalogItem.Type

export function toPublicCatalogItem(
  item: CatalogItem,
  unitId: string,
  categoryNameById?: ReadonlyMap<string, string>,
): PublicCatalogItem {
  const resolved = resolveCatalogItemForUnit(item, unitId)
  const priceVisibility = normalizeServicePriceVisibility(item.priceVisibility)
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    categoryId: item.categoryId,
    categoryName:
      item.categoryId !== null ? (categoryNameById?.get(item.categoryId) ?? null) : null,
    requiredResources: isCatalogService(item) ? item.requiredResources : [],
    priceCents: priceVisibility === 'on_request' ? null : resolved.priceCents,
    durationMinutes: isCatalogService(item) ? resolved.durationMinutes : null,
  }
}
