// Internal write/saga helpers for the order actions — extracted from the
// 'use server' module to stay under the module-size gate. Not server actions;
// imperative-shell helpers the close/item actions compose.

import {
  accrueCommissionForItem,
  type Commission,
  coverageOf,
  coveredItemQuantity,
  isItemCoveredBySubscription,
  isOperational,
  type LiquidationStatus,
  type Membership,
  type Order,
  type OrderItem,
  type OrderItemKind,
  type PaymentMethod,
  stockDecrementTargets,
  type Subscription,
} from '@/domain'
import type { ParsedAssignCustomer } from '@/features/orders/core/assign-customer-form'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'

import { getCustomerById } from '@/shared/org/customer-read'
import { getMemberOperationByUserId } from '@/shared/org/member-operation-read'
import {
  canActOnOwnedResource,
  getMembership,
  listOrgMembers,
  operatesFrontDesk,
} from '@/shared/org/membership'
import { resolveCustomerIdForWrite } from '@/shared/org/resolve-customer-for-write'
import { loadActiveSubscriptionForCustomer, loadOrderById } from './order-financial-read'

// Own-resource policy for an OPEN order (brief 0075, #1257): the balcão
// (owner/manager/recepção) operates any comanda; a self-scoped memberOperation
// operates one only when EVERY item is attributed to them — so they can't touch
// a colleague's order (remove items, re-attribute commission to themselves,
// apply discounts). An order with no items yet (just opened) is vacuously theirs,
// so they can add the first item. Orders carry no `member_operation_id` column, so
// RLS can't enforce this — the gate lives here, in the app layer. Mirrors
// `canCloseOrder` (close.actions.ts), the close-time form of the same rule.
export function canOperateOpenOrder(membership: Membership, items: readonly OrderItem[]): boolean {
  if (operatesFrontDesk(membership)) return true
  return items.every((item) => item.attributedUserId === membership.userId)
}

// Discriminated guard result wrapper so call-sites stay one-liners. Returns the
// error result when the member may not operate the order, else null.
export function denyIfNotOwnOrder(
  membership: Membership,
  items: readonly OrderItem[],
): { ok: false; error: string } | null {
  if (canOperateOpenOrder(membership, items)) return null
  return { ok: false, error: 'Você só pode editar comandas atribuídas a você' }
}

// Own-scope attribution guard (brief 0075, #1267). `denyIfNotOwnOrder` protects an
// order by its EXISTING items, so a freshly-opened (empty) comanda passes vacuously
// — a self-scoped member could then attribute an item to a colleague (wrong
// commission line). This gates the ATTRIBUTION TARGET itself: the balcão attributes
// to anyone; a self-scoped member only to themselves. Mirrors `denyIfNotOwnOrder`'s
// one-liner shape. Returns the error result when disallowed, else null.
export function denyIfCannotAttributeTo(
  membership: Membership,
  attributedUserId: string,
): { ok: false; error: string } | null {
  if (canActOnOwnedResource(membership, attributedUserId)) return null
  return { ok: false, error: 'Você só pode atribuir itens a si mesmo' }
}

export function genItemId(): string {
  // ID curto suficiente pra colisão ser improvável dentro de uma única
  // order (≤ ~50 items na prática). Não precisa ser UUID — Firestore.id
  // só importa para o documento da order, items são embarcados.
  return Math.random().toString(36).slice(2, 12)
}

// Coleção `appointments` permite só os statuses do tipo Appointment.
// `completed` é o destino final quando a order fecha; antes disso o
// agendamento fica `scheduled` (não tem estado "em andamento" — o link via
// order.appointmentId já marca que tem order aberta).

// Reads the order from the typed Postgres projection under RLS. The item-edit
// call-sites only ever needed the order doc (they write via the path-based
// `emitEvent`), so the helper takes the `orgId` directly.
export async function loadOpenOrder(
  orgId: string,
  orderId: string,
): Promise<{ order: Order } | string> {
  const order = await loadOrderById(orgId, orderId)
  if (!order) return 'Venda não encontrada'
  if (order.status !== 'open') return 'Venda já foi fechada ou cancelada'
  return { order }
}

// Snapshot puro do item a partir do doc JÁ LIDO (dentro da transação do guard,
// brief 0033 AC-08). Separa a leitura (transacional, no caller) da resolução
// (pura) pra a checagem de descontinuação + o snapshot de preço/comissão
// rodarem atômicos com o write. `archivedAt` set = descontinuado → rejeita
// (AC-08). Preço = `min(exibido, vigente)` (AC-09): nunca cobra mais que o
// exibido ao operador; quando o exibido não veio, cobra o vigente.
// AC-05 (brief 0030): "membro pode operar" generaliza o antigo
// `assertExecutorApproved` (que carregava um MemberOperation por doc id e exigia
// aprovação). O alvo da atribuição agora é o `userId` de QUALQUER membro, então
// a validação é:
//
//   1. Existe membership ativa `{tid}_{userId}` no org, com papel operacional
//      (não `customer`), e — se a membership for unit-scoped — escopada à
//      unidade da venda.
//   2. Item de SERVIÇO mantém a trava mais estrita: SE existe a projeção
//      `MemberOperation` para esse `userId`, ela precisa estar aprovada (preserva o
//      fluxo de serviço atual). Produto/venda avulsa NÃO exige MemberOperation —
//      basta ser membro ativo (é o que destrava o varejo: recepção vende balcão).
//
// Mantém o comportamento de serviço intacto e destrava produto sem profissional
// aprovado.
export async function assertMemberCanOperate({
  orgId,
  attributedUserId,
  kind,
  orderUnitId,
}: {
  orgId: string
  attributedUserId: string
  kind: OrderItemKind
  orderUnitId: string
}): Promise<string | null> {
  if (!attributedUserId) return 'Membro atribuído é obrigatório'

  // Membership é top-level (`memberships/{tid}_{userId}`), resolvida por
  // (orgId, userId) na projeção tipada sob RLS.
  const membership = await getMembership(orgId, attributedUserId)
  if (!membership) return 'Membro não encontrado neste negócio'
  if (membership.status !== 'active') return 'Membro não está ativo neste negócio'
  // No `customer` role to exclude anymore (brief 0068 D4 / AC-04): a client is a
  // `customers` row, never a membership, so any active member is assignable.
  // Membership unit-scoped (recepção de uma unidade) só opera na própria unidade.
  if (membership.rlsUnitScope && membership.rlsUnitScope !== orderUnitId) {
    return 'Membro não opera nesta unidade'
  }

  // Trava de serviço (AC-05): só serviço exige MemberOperation aprovado, e só quando
  // a projeção existe para esse membro. Sem projeção (ex.: membro que ainda não
  // virou profissional) o serviço fica bloqueado — fluxo de serviço inalterado.
  if (kind === 'service') {
    const memberOperation = await getMemberOperationByUserId(orgId, attributedUserId)
    if (!memberOperation)
      return 'Serviço exige um profissional — membro sem cadastro de profissional'
    if (!isOperational(memberOperation.operationalStatus)) {
      return `Profissional não operacional (status: ${memberOperation.operationalStatus})`
    }
  }

  return null
}

// Cobertura por item (brief 0021 AC-03): marca um item como `sale` (venda) ou
// `subscription` (consumo do plano do cliente). Brief 0024: consumo cobre
// QUALQUER kind (serviço ou produto) desde que o item esteja no snapshot
// congelado da assinatura (`includedItemIds` + categoria expandida) e haja saldo.
// Recalcula totais (coberto sai do total a pagar) — event-first.
// Resolve a single item's subscription coverage at marking time (brief 0024,
// AC-04): the item must be in the frozen snapshot and the plan must have
// remaining balance (excluding this item, any kind). Returns the subscription id
// to attach, or an error message.
// Inputs to the consumption-coverage resolver. `idx` is `target`'s position in
// `order.items` (excluded from the already-covered balance tally). `catalogHint`
// lets a caller that already loaded the target's catalog row pass it in to skip
// a second RLS-scoped SELECT — coverage needs only `id` + `categoryId`.
type ItemCoverageInput = {
  orgId: string
  order: Order
  target: OrderItem
  idx: number
  catalogHint?: { id: string; categoryId: string | null }
}

export async function resolveItemCoverageSubscription(
  args: ItemCoverageInput,
): Promise<{ subscriptionId: string } | string> {
  const { orgId, order, target, idx, catalogHint } = args
  // Venda avulsa anônima (brief 0030, AC-02) não tem cliente → sem assinatura.
  if (!order.customerId) return 'Venda sem cliente não pode consumir assinatura'
  const sub = await loadActiveSubscriptionForCustomer(orgId, order.customerId)
  if (!sub) return 'Cliente não possui assinatura ativa'

  const catalogItem = catalogHint ?? (await getCatalogItemById(orgId, target.refId))
  if (!catalogItem) return 'Item não encontrado no catálogo'
  if (!isItemCoveredBySubscription(sub.plan, catalogItem)) {
    return 'Item não está coberto pelo plano do cliente'
  }

  // Saldo restante = limite − consumido − já coberto nesta comanda (exceto este).
  if (sub.plan.usageLimit.kind === 'count') {
    const alreadyCovered = coveredItemQuantity(order.items.filter((_, i) => i !== idx))
    const remaining = sub.plan.usageLimit.quantity - sub.currentPeriod.consumed - alreadyCovered
    if (remaining < target.quantity) return 'Assinatura sem saldo restante para cobrir este item'
  }
  return { subscriptionId: sub.id }
}

// Auto-mark coverage default (brief 0079, AC-06). Resolves whether `target`
// should enter as `subscription` (covered + balance) and, when so, mutates it in
// place (`coverage`/`subscriptionId`). Returns the subscription id to feed the
// `order_item_coverage_autoset` analytics event, or null when the item stays
// `sale` (no customer / not covered / no balance — AC-07). Shared by the two
// comanda entry points (`startAttendance`'s appointment item and
// `addItemToOrder`) so the auto-mark rule lives in one place.
export async function autoMarkCoverageDefault(args: ItemCoverageInput): Promise<string | null> {
  const resolved = await resolveItemCoverageSubscription(args)
  if (typeof resolved === 'string') return null
  args.target.coverage = 'subscription'
  args.target.subscriptionId = resolved.subscriptionId
  return resolved.subscriptionId
}

// Resolves the customer id to assign to a walk-in order from the parsed selector
// intent (brief 0081 / #1323): `none` → null (unlink); `new` → upsert inline via
// the shared resolver (gated on canManageCustomers); `existing` → the picked id,
// guarded to exist under THIS org (RLS-scoped read blocks a cross-org id smuggled
// in the form). Extracted from the action to keep it under the complexity gate.
// Returns `{ customerId }` or `{ error }` to early-return.
export async function resolveAssignedCustomerId(
  orgId: string,
  membership: Membership,
  parsed: ParsedAssignCustomer,
): Promise<{ customerId: string | null } | { error: string }> {
  if (parsed.mode === 'none') return { customerId: null }
  const resolved = await resolveCustomerIdForWrite(
    membership,
    parsed.mode === 'new'
      ? { customerId: null, newCustomer: parsed.newCustomer }
      : { customerId: parsed.customerId, newCustomer: null },
  )
  if (!resolved.ok) return { error: resolved.error }
  if (parsed.mode === 'existing') {
    const customer = await getCustomerById(orgId, resolved.customerId)
    if (!customer) return { error: 'Cliente não encontrado neste estabelecimento' }
  }
  return { customerId: resolved.customerId }
}

// Re-evaluates subscription coverage for EVERY item after the order's customer
// changed (link / swap / unlink — brief 0081 Cenário 4). Runs the SAME per-item
// rule as `autoMarkCoverageDefault`, so a walk-in that links a subscriber sees the
// covered items auto-marked exactly as if they'd been added after the link
// (Cenário 2), and an item that lost its coverage (customer removed / swapped to a
// non-subscriber / no balance) falls back to `sale` — never stays covered against
// a customer that can't cover it. Returns a fresh item array (pure w.r.t. the
// input); the caller recomputes totals + emits. The balance tally is greedy in
// item order: each item is resolved as if the earlier ones already took their
// share (via `idx`), so the plan quota isn't double-counted across the comanda.
export async function reevaluateCoverageForItems(
  orgId: string,
  order: Order,
): Promise<OrderItem[]> {
  const next: OrderItem[] = []
  for (let idx = 0; idx < order.items.length; idx++) {
    const item = order.items[idx]!
    // Resolve against the running `next` (already-reevaluated) items so the
    // remaining-balance tally reflects what earlier items just consumed.
    const resolved = await resolveItemCoverageSubscription({
      orgId,
      order: { ...order, items: [...next, ...order.items.slice(idx)] },
      target: item,
      idx,
    })
    if (typeof resolved === 'string') {
      next.push({ ...item, coverage: 'sale', subscriptionId: null })
    } else {
      next.push({ ...item, coverage: 'subscription', subscriptionId: resolved.subscriptionId })
    }
  }
  return next
}

// Resolução de cobertura no consumo (brief 0024, AC-04): cada item coberto
// precisa estar no snapshot CONGELADO da assinatura (item explícito ou categoria
// de conveniência). Lê o `categoryId` vivo do catálogo. Retorna erro ou null.
export async function validateCoveredItems(
  orgId: string,
  coveredItems: OrderItem[],
  plan: Subscription['plan'],
): Promise<string | null> {
  const catalogItems = await Promise.all(
    [...new Set(coveredItems.map((it) => it.refId))].map((refId) =>
      getCatalogItemById(orgId, refId),
    ),
  )
  const categoryByRefId = new Map<string, string | null>()
  for (const item of catalogItems) {
    if (!item) continue
    categoryByRefId.set(item.id, item.categoryId)
  }
  for (const it of coveredItems) {
    const categoryId = categoryByRefId.get(it.refId)
    if (categoryId === undefined) return `Item coberto "${it.name}" não está mais no catálogo`
    if (!isItemCoveredBySubscription(plan, { id: it.refId, categoryId })) {
      return `Item "${it.name}" não está coberto pelo plano do cliente`
    }
  }
  return null
}

export type ConsumptionPlan = {
  subscriptionToConsume: { id: string; amount: number } | null
  stockDecrements: { refId: string; quantity: number }[]
}

// Consumo no fechamento (brief 0024, Grupo B): resolve o que decrementar — cota
// de assinatura E estoque — em UM lugar. As duas regras são independentes por
// design (#B4): estoque baixa para TODO produto (`stockDecrementTargets`, imune a
// coverage); a cota só debita quando há item coberto e assinatura ativa com
// saldo. Retorna o plano de consumo, ou uma mensagem de erro.
export async function resolveSubscriptionConsumption(
  orgId: string,
  order: Order,
  sale: boolean,
): Promise<ConsumptionPlan | string> {
  const coveredQty = coveredItemQuantity(order.items)
  if (!sale && coveredQty === 0) return 'Venda sem itens de venda nem consumo de assinatura'
  // Estoque é desacoplado de coverage: computado SEMPRE, mesmo em venda 100%
  // avulsa (que antes retornava cedo sem baixar — a raiz do #B4). Fonte única
  // compartilhada com o undo (`stockDecrementTargets`) → o que baixa é o que
  // devolve, por construção.
  const stockDecrements = stockDecrementTargets(order.items)

  if (coveredQty === 0) return { subscriptionToConsume: null, stockDecrements }
  // Consumo de cota exige cliente — venda avulsa anônima (brief 0030) nunca marca
  // item como `subscription`, então nunca chega aqui com coveredQty > 0.
  if (!order.customerId) return 'Venda sem cliente não pode consumir assinatura'
  const sub = await loadActiveSubscriptionForCustomer(orgId, order.customerId)
  if (!sub) return 'Cliente não possui assinatura ativa para o consumo marcado'

  const coverErr = await validateCoveredItems(
    orgId,
    order.items.filter((it) => coverageOf(it) === 'subscription'),
    sub.plan,
  )
  if (coverErr) return coverErr

  if (sub.plan.usageLimit.kind === 'count') {
    const remaining = sub.plan.usageLimit.quantity - sub.currentPeriod.consumed
    if (remaining < coveredQty) {
      return `Saldo insuficiente: ${remaining} restante(s) no ciclo, consumo requer ${coveredQty}`
    }
  }
  return {
    subscriptionToConsume: { id: sub.id, amount: coveredQty },
    stockDecrements,
  }
}

// Apura comissões no fechamento (brief 0022 #998): toda comissão nasce
// `pendente`. Identidade do profissional CONGELADA no doc (brief 0041 AC-11).
// Comanda 100% coberta (sem paymentMethod) não comissiona.
export async function buildOrderCommissions(args: {
  orgId: string
  orderId: string
  items: OrderItem[]
  paymentMethod: PaymentMethod | null
  closedAt: string
}): Promise<Commission[]> {
  if (!args.paymentMethod) return []
  const memberNameByUserId = new Map(
    (await listOrgMembers(args.orgId)).map((m) => [m.userId, m.name]),
  )
  const resolveMemberName = (userId: string): string => memberNameByUserId.get(userId) ?? ''

  const commissions: Commission[] = []
  for (const item of args.items) {
    const accrual = accrueCommissionForItem(item, resolveMemberName)
    if (!accrual) continue
    commissions.push({
      id: newId(),
      orgId: args.orgId,
      orderId: args.orderId,
      orderItemId: accrual.orderItemId,
      attributedUserId: accrual.attributedUserId,
      attributedMemberName: accrual.attributedMemberName,
      itemKind: accrual.itemKind,
      itemName: accrual.itemName,
      itemTotalCents: accrual.itemTotalCents,
      commissionKind: accrual.commissionKind,
      commissionValue: accrual.commissionValue,
      amountCents: accrual.amountCents,
      liquidationStatus: 'pendente' satisfies LiquidationStatus,
      createdAt: args.closedAt,
    })
  }
  return commissions
}
