// Pure presentation logic for the order detail view, extracted from the
// 'use client' component (Functional Core / Imperative Shell) so the catalog
// build, POS quick-search filter, quantity clamp, status line and labels are
// importable + unit-tested. No React, no I/O. The component keeps the JSX and
// the action calls.

import {
  type CatalogProductItem,
  type CatalogServiceItem,
  type Order,
  type OrderItemKind,
  type PaymentMethod,
} from '@/domain'

// AC-11: one option type spanning both kinds. The select option value encodes
// `kind:refId` so the chosen item drives the line's `kind` — no separate
// service/product picker. `code` is the product SKU (null for services) — the
// POS quick-search (brief 0030, AC-10) matches on name OR code.
export type CatalogOption = {
  id: string
  name: string
  priceCents: number
  kind: OrderItemKind
  code: string | null
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  pix: 'PIX',
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// AC-04 (brief 0030): o controle de atribuição é UM campo só (`attributedUserId`),
// rotulado por `kind` — "Executor" pra serviço, "Vendedor" pra produto.
export function attributionLabel(kind: OrderItemKind): string {
  return kind === 'service' ? 'Executor' : 'Vendedor'
}

export function statusLine(
  order: Pick<Order, 'status' | 'createdAt' | 'updatedAt' | 'closedAt' | 'paymentMethod'>,
): string {
  if (order.status === 'open') {
    return `Aberta em ${new Date(order.createdAt).toLocaleString('pt-BR')}`
  }
  if (order.status === 'cancelled') {
    return `Cancelada em ${new Date(order.updatedAt).toLocaleString('pt-BR')}`
  }
  const closedAt = order.closedAt ? new Date(order.closedAt).toLocaleString('pt-BR') : '—'
  const method = order.paymentMethod ? PAYMENT_LABEL[order.paymentMethod] : '—'
  return `Fechada em ${closedAt} · ${method}`
}

// Accent/case-insensitive normalize for the POS quick-search (AC-10).
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// AC-11: merge services + products into one catalog option list, sorted by name
// so both kinds interleave. Products carry their `sku` as `code` so the POS
// quick-search can match by code.
export function buildCatalogOptions(
  services: Pick<CatalogServiceItem, 'id' | 'name' | 'priceCents'>[],
  products: Pick<CatalogProductItem, 'id' | 'name' | 'priceCents' | 'sku'>[],
): CatalogOption[] {
  return [
    ...services.map((s) => ({
      id: s.id,
      name: s.name,
      priceCents: s.priceCents,
      kind: 'service' as const,
      code: null,
    })),
    ...products.map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      kind: 'product' as const,
      code: p.sku,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// AC-10: filter the catalog picker by name OR code (product SKU),
// case/accent-insensitive. Empty query returns the full list.
export function filterCatalog(options: CatalogOption[], search: string): CatalogOption[] {
  const q = normalizeSearch(search)
  if (!q) return options
  return options.filter(
    (o) =>
      normalizeSearch(o.name).includes(q) || (o.code ? normalizeSearch(o.code).includes(q) : false),
  )
}

// Service lines are always qty 1 (duration/commission are per execution);
// product qty clamps to [1, 999].
export function clampQuantity(quantity: number, isService: boolean): number {
  return isService ? 1 : Math.min(999, Math.max(1, quantity))
}
