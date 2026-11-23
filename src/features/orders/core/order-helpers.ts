import {
  type CatalogItem,
  type Order,
  type OrderItem,
  type OrderItemKind,
  type PaymentMethod,
  PAYMENT_METHODS,
  computeOrderTotals,
  isCatalogProduct,
  isCatalogService,
  lawfulPriceCents,
  resolveCatalogItemForUnit,
} from '@/domain'
import { formString } from '@/shared/form-data'

export type ParsedItem = {
  kind: OrderItemKind
  refId: string
  quantity: number
  attributedUserId: string
  displayedPriceCents: number | null
}

export function parseItemForm(formData: FormData): ParsedItem | string {
  const kindRaw = formString(formData, 'kind')
  if (kindRaw !== 'service' && kindRaw !== 'product') return 'Tipo de item inválido'
  const refId = formString(formData, 'refId').trim()
  if (!refId) return kindRaw === 'service' ? 'Serviço é obrigatório' : 'Produto é obrigatório'

  const qty = Number(formData.get('quantity'))
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return 'Quantidade inválida'
  if (kindRaw === 'service' && qty !== 1) {
    return 'Serviço sempre tem quantidade 1 — adicione outro item se precisar'
  }

  const attributedUserId = formString(formData, 'attributedUserId').trim()

  const displayedRaw = formString(formData, 'displayedPriceCents').trim()
  let displayedPriceCents: number | null = null
  if (displayedRaw) {
    const n = Number(displayedRaw)
    if (!Number.isInteger(n) || n < 0) return 'Preço exibido inválido'
    displayedPriceCents = n
  }

  return {
    kind: kindRaw,
    refId,
    quantity: Math.floor(qty),
    attributedUserId,
    displayedPriceCents,
  }
}

export function snapshotCatalogItem(
  item: CatalogItem | null,
  parsed: ParsedItem,
  unitId: string,
): Omit<OrderItem, 'id'> | string {
  if (parsed.kind === 'service') {
    if (!item) return 'Serviço não encontrado'
    if (!isCatalogService(item)) return 'Item não é um serviço'
    if (!item.active || item.archivedAt) return 'Serviço descontinuado'
  } else {
    if (!item) return 'Produto não encontrado'
    if (!isCatalogProduct(item)) return 'Item não é um produto'
    if (!item.active || item.archivedAt) return 'Produto descontinuado'
  }
  const resolved = resolveCatalogItemForUnit(item, unitId)
  const unitPriceCents = lawfulPriceCents(parsed.displayedPriceCents, resolved.priceCents)
  return {
    kind: parsed.kind,
    refId: item.id,
    name: item.name,
    quantity: parsed.quantity,
    unitPriceCents,
    commission: resolved.commission,
    attributedUserId: parsed.attributedUserId,
  }
}

export function recalcAndPatch(
  items: OrderItem[],
  discountCents: number,
): Partial<Order> & { updatedAt: string } {
  const totals = computeOrderTotals(items, discountCents)
  return {
    items,
    discountCents,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    updatedAt: new Date().toISOString(),
  }
}

export function parsePaymentMethod(raw: string): PaymentMethod | null {
  return PAYMENT_METHODS.find((method) => method === raw) ?? null
}

export function validateClosableItems(items: OrderItem[]): string | null {
  if (items.length === 0) return 'Venda vazia — adicione pelo menos um item'
  for (const item of items) {
    if (!item.attributedUserId) return `Item "${item.name}" sem membro atribuído`
  }
  return null
}
