import {
  type CatalogProductItem,
  type CatalogServiceItem,
  type Order,
  type OrderItemKind,
  type PaymentMethod,
} from '@/domain'

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

export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

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

export function filterCatalog(options: CatalogOption[], search: string): CatalogOption[] {
  const q = normalizeSearch(search)
  if (!q) return options
  return options.filter(
    (o) =>
      normalizeSearch(o.name).includes(q) || (o.code ? normalizeSearch(o.code).includes(q) : false),
  )
}

export function clampQuantity(quantity: number, isService: boolean): number {
  return isService ? 1 : Math.min(999, Math.max(1, quantity))
}
