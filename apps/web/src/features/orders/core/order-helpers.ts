// Pure order-building helpers, extracted from the `'use server'` actions module
// so they're importable + unit-testable (they were trapped inside the server
// file before, reachable only via e2e). No I/O here — Firestore loads, event
// emission and revalidation stay in the actions. These cover the financially
// load-bearing bits: form parsing/validation, the lawful-price snapshot, totals
// recompute, payment-method parsing and closability checks.

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
  // `userId` do membro atribuído (brief 0030, AC-04). Vazio = aplica o default
  // esperto no servidor (produto/avulsa → opener; serviço → idem fallback).
  attributedUserId: string
  // Preço unitário EXIBIDO ao operador no momento de montar o carrinho (brief
  // 0033 AC-09). `null` quando a UI não mandou (ex.: progressive-enhancement sem
  // JS) — aí o commit cobra o preço vigente sem o teto do exibido.
  displayedPriceCents: number | null
}

export function parseItemForm(formData: FormData): ParsedItem | string {
  const kindRaw = formString(formData, 'kind')
  if (kindRaw !== 'service' && kindRaw !== 'product') return 'Tipo de item inválido'
  const refId = formString(formData, 'refId').trim()
  if (!refId) return kindRaw === 'service' ? 'Serviço é obrigatório' : 'Produto é obrigatório'

  const qty = Number(formData.get('quantity'))
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return 'Quantidade inválida'
  // Serviços só fazem sentido em qty=1 — duração e comissão são por execução.
  // Múltiplas execuções = múltiplos items.
  if (kindRaw === 'service' && qty !== 1) {
    return 'Serviço sempre tem quantidade 1 — adicione outro item se precisar'
  }

  // Atribuição é OBRIGATÓRIA com default (AC-04): a UI manda o `userId` do membro
  // pré-selecionado; se vier vazio, o caller aplica o default (membro que abriu).
  const attributedUserId = formString(formData, 'attributedUserId').trim()

  // Preço exibido ao operador (brief 0033 AC-09). Campo opcional — sem ele o
  // commit não aplica o teto `min(exibido, vigente)` (cobra o vigente).
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
  // Use per-unit effective price/commission (#874). Order é unit-scoped, então a
  // unit do order define qual override aplica.
  const resolved = resolveCatalogItemForUnit(item, unitId)
  // AC-09 — preço na divergência segue a lei (CDC art. 30 + Decreto 5.903/2006
  // art. 5º): cobra o MENOR entre o exibido e o vigente, nunca mais que o exibido.
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

// Defesa em profundidade (brief 0030, AC-04): comanda não-vazia e todo item com
// membro atribuído. Retorna a mensagem de erro, ou null quando ok.
export function validateClosableItems(items: OrderItem[]): string | null {
  if (items.length === 0) return 'Venda vazia — adicione pelo menos um item'
  for (const item of items) {
    if (!item.attributedUserId) return `Item "${item.name}" sem membro atribuído`
  }
  return null
}
