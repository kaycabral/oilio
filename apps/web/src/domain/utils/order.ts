import type { CommissionRule } from '../types/member-operation'
import { coverageOf, type Order, type OrderItem } from '../types/order'

export type OrderTotals = {
  subtotalCents: number
  totalCents: number
}

export function computeItemLineTotal(item: Pick<OrderItem, 'quantity' | 'unitPriceCents'>): number {
  return item.quantity * item.unitPriceCents
}

// Total a pagar = só itens de venda (brief 0021, AC-05): itens cobertos por
// assinatura (consumo) não compõem receita nem o valor a pagar. Itens sem
// `coverage` são lidos como `sale` (migração implícita).
export function computeOrderTotals(
  items: readonly Pick<OrderItem, 'quantity' | 'unitPriceCents' | 'coverage'>[],
  discountCents: number,
): OrderTotals {
  const subtotalCents = items
    .filter((it) => coverageOf(it) === 'sale')
    .reduce((acc, it) => acc + computeItemLineTotal(it), 0)
  // Desconto nunca pode deixar total negativo — clamp em zero.
  const totalCents = Math.max(0, subtotalCents - discountCents)
  return { subtotalCents, totalCents }
}

// Quantidade de serviços cobertos por assinatura (consumo) numa comanda —
// base da contagem de atendimentos cobertos por profissional (brief 0022) e do
// relatório. Produto coberto não é atendimento (baixa estoque, ver
// `coveredItemQuantity`).
export function coveredServiceQuantity(
  items: readonly Pick<OrderItem, 'quantity' | 'kind' | 'coverage'>[],
): number {
  return items
    .filter((it) => it.kind === 'service' && coverageOf(it) === 'subscription')
    .reduce((acc, it) => acc + it.quantity, 0)
}

// Quantidade de itens cobertos por assinatura (consumo) numa comanda, de
// qualquer kind (brief 0024, Grupo B — AC-04/05). É a base do decremento do
// saldo do plano (`currentPeriod.consumed`): a cota do plano vale para qualquer
// item coberto (serviço OU produto), não só serviços. O `usageLimit` é avaliado
// contra esta soma. Produtos cobertos, além de contar a cota, baixam estoque.
export function coveredItemQuantity(
  items: readonly Pick<OrderItem, 'quantity' | 'coverage'>[],
): number {
  return items
    .filter((it) => coverageOf(it) === 'subscription')
    .reduce((acc, it) => acc + it.quantity, 0)
}

// Produtos cobertos por assinatura numa comanda — baixam estoque/COGS no
// fechamento (brief 0024, AC-05). Serviços cobertos NÃO baixam estoque (entram
// na contagem de atendimentos via `coveredServiceQuantity`).
export function coveredProducts(
  items: readonly OrderItem[],
): { refId: string; quantity: number }[] {
  return items
    .filter((it) => it.kind === 'product' && coverageOf(it) === 'subscription')
    .map((it) => ({ refId: it.refId, quantity: it.quantity }))
}

export function hasSaleItem(items: readonly Pick<OrderItem, 'coverage'>[]): boolean {
  return items.some((it) => coverageOf(it) === 'sale')
}

export function computeCommissionAmountCents(itemTotalCents: number, rule: CommissionRule): number {
  if (rule.kind === 'percentage') {
    // CommissionRule.value pra percentage é 0–100 (não fracionário).
    // Arredondamento half-up via Math.round — perda < 1 centavo por item.
    return Math.round((itemTotalCents * rule.value) / 100)
  }
  // 'fixed' — valor é em centavos, independente do preço do item.
  return rule.value
}

export function isOrderEditable(order: Pick<Order, 'status'>): boolean {
  return order.status === 'open'
}

// AC-02 (brief 0022 #999): decisão de accrual por item no fechamento. Retorna o
// snapshot da comissão a registrar, ou `null` quando o item não comissiona:
//   - consumo de assinatura (`coverage = subscription`) não gera Commission (0021 AC-09);
//   - item sem regra de comissão (`commission: null`, ex.: produto) é pulado;
//   - regra que resulta em 0 centavo não vira registro.
// Pura e unit-testável — o caller (closeOrder) só persiste o que ela aprova.
export type CommissionAccrual = {
  orderItemId: string
  attributedUserId: string
  // Nome identificável do membro atribuído, snapshotado na apuração (brief 0041
  // AC-11) — retenção de vínculo (art. 16). Vazio se não resolvido/sem membro.
  attributedMemberName: string
  itemKind: OrderItem['kind']
  itemName: string
  itemTotalCents: number
  commissionKind: CommissionRule['kind']
  commissionValue: number
  amountCents: number
}

// `resolveMemberName` mapeia o `attributedUserId` do item pro display name do
// membro NO MOMENTO da apuração (brief 0041 AC-11). O caller (closeOrder) passa
// o resolver do contexto do org; retorna '' quando não há membro atribuído
// ou ele não pôde ser resolvido — nunca lança. Default no-op mantém a função
// pura e os call-sites de teste antigos compatíveis (snapshot vazio).
export function accrueCommissionForItem(
  item: OrderItem,
  resolveMemberName: (userId: string) => string = () => '',
): CommissionAccrual | null {
  if (coverageOf(item) === 'subscription') return null
  if (!item.commission) return null
  const itemTotalCents = computeItemLineTotal(item)
  const amountCents = computeCommissionAmountCents(itemTotalCents, item.commission)
  if (amountCents <= 0) return null
  return {
    orderItemId: item.id,
    // Comissão chaveada por membro (brief 0030, AC-07): a chave é o `userId` do
    // membro atribuído ao item — qualquer papel, não só MemberOperation. Para
    // serviço executado por profissional é a mesma identidade.
    attributedUserId: item.attributedUserId,
    // Snapshot identificável do nome (AC-11) — self-contained, imune a
    // revogado/suspenso/anonimizado-como-cliente.
    attributedMemberName: item.attributedUserId ? resolveMemberName(item.attributedUserId) : '',
    itemKind: item.kind,
    itemName: item.name,
    itemTotalCents,
    commissionKind: item.commission.kind,
    commissionValue: item.commission.value,
    amountCents,
  }
}
