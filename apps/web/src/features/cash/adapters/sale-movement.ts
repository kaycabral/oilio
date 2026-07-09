import type { CashMovement, PaymentMethod } from '@/domain'
import { CashMovementConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import 'server-only'

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
    aggregateRef(CashMovementConfig, params.orgId, movement.id),
    { _tag: 'cash_movement.created', actorId: params.actorUid, payload: { data: movement } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  return { ok: true, movementId: movement.id }
}
