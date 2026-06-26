import type { CashMovement, PaymentMethod } from '@/domain'
import { CashMovementConfig } from '@/domain/aggregates'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import 'server-only'

// Builds the `sale` movement doc (a fresh id + the full append-only row) without
// persisting it — shared by `recordSaleMovement` (the standalone Firestore path)
// and the ACID close-order saga (brief 0061 § Grupo A), so both construct the
// SAME shape. The id is a backend-agnostic UUID (`newId`) — the Postgres path
// stores it under the same `orgs/{orgId}/cash_movements/{id}` path.
export function buildSaleMovement(params: {
  orgId: string
  unitId: string
  orderId: string
  amountCents: number
  paymentMethod: PaymentMethod
  actorUid: string
}): CashMovement {
  const movementId = newId()
  return {
    id: movementId,
    orgId: params.orgId,
    unitId: params.unitId,
    kind: 'sale',
    direction: 'in',
    amountCents: params.amountCents,
    paymentMethod: params.paymentMethod,
    description: null,
    orderId: params.orderId,
    expenseCategoryId: null,
    recordedByUid: params.actorUid,
    createdAt: new Date().toISOString(),
  }
}

// Grava um movement `sale` standalone (brief 0015 — caixa sem sessão): a parte
// vendida em dinheiro de uma comanda vira movimento financeiro SEMPRE, sem
// depender de caixa aberto. Event-first (brief 0025 #1019): o movimento nasce
// de `cash_movement.created` (a projeção escreve o doc) — auditoria = stream.
// Idempotência por orderId é do caller — closeOrder chama uma vez por fechamento.
export async function recordSaleMovement(params: {
  orgId: string
  unitId: string
  orderId: string
  amountCents: number
  paymentMethod: PaymentMethod
  actorUid: string
}): Promise<{ ok: true; movementId: string } | { ok: false; error: string }> {
  const movement = buildSaleMovement(params)
  const created = await emitEvent(
    CashMovementConfig,
    `orgs/${params.orgId}/cash_movements/${movement.id}`,
    { _tag: 'cash_movement.created', actorId: params.actorUid, payload: { data: movement } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  return { ok: true, movementId: movement.id }
}
