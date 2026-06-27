// Seed a CLOSED sale the same way the production close-order saga does
// (`features/orders/adapters/order-saga.ts` `buildCloseOrderSteps`), but inlined
// here because that module is `server-only` (it can't be imported by a `tsx`
// script). The order is born open (`order.created` carries a valid `OpenOrder`
// with its items) and the cascade closes it as ONE ACID transaction:
//   order.created → commission.created (per commissioned item) →
//   cash_movement.created (sale) → order.closed (anchor)
// Mirrors the saga ordering: leaf aggregates before the order that integrates.
//
// The seed keeps sales SIMPLE — no subscription coverage, no stock decrement —
// so it doesn't need the live-catalog reads the real saga does. Commissions are
// computed from each item's snapshotted rule (percentage/fixed), the same math
// the close performs.

import type { PaymentMethod } from '@/domain'
import { CashMovementConfig, CommissionConfig, OrderConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type SagaStep } from '@/domain/effect'
import type { OrderItem } from '@/domain/types/order'
import { commitSaga } from '@/shared/effect-bridge'
import { buildCommission } from '@/shared/fixtures/domain-builders'
import { buildOpenOrder, buildSaleMovement } from '@/shared/fixtures/seed-domain-builders'
import { newId } from './ids'

export interface SeedClosedSaleInput {
  orderId: string
  orgId: string
  unitId: string
  customerId: string
  items: OrderItem[]
  paymentMethod: PaymentMethod
  // The member who rang up / closed the sale (the cash movement's recorder).
  recordedByUid: string
  // Display name per attributed member, for the commission's frozen snapshot.
  memberNames: Record<string, string>
  now: string
}

function commissionCents(item: OrderItem): number {
  if (item.commission === null) return 0
  const total = item.unitPriceCents * item.quantity
  return item.commission.kind === 'percentage'
    ? Math.round((total * item.commission.value) / 100)
    : item.commission.value
}

// Persists one closed sale via the ACID close cascade. Returns the order id.
export async function seedClosedSale(input: SeedClosedSaleInput): Promise<string> {
  // An OPEN order carries no paymentMethod (null by construction) — it's set
  // only at close, in the `order.closed` payload below.
  const order = buildOpenOrder({
    id: input.orderId,
    orgId: input.orgId,
    unitId: input.unitId,
    customerId: input.customerId,
    now: input.now,
    overrides: { items: input.items },
  })

  const steps: SagaStep[] = []

  // order.created — the open order with its items (the close needs an open order).
  steps.push((tx) =>
    appendEventToTx(
      OrderConfig,
      aggregateRef(OrderConfig, input.orgId, input.orderId),
      { _tag: 'order.created', actorId: input.recordedByUid, payload: { data: order } },
      tx,
    ),
  )

  // commission.created — one per commissioned item (leaf before the order).
  for (const item of input.items) {
    const amountCents = commissionCents(item)
    if (amountCents === 0 || item.commission === null) continue
    const commission = buildCommission(newId(), input.orgId, input.now, {
      orderId: input.orderId,
      orderItemId: item.id,
      attributedUserId: item.attributedUserId,
      attributedMemberName: input.memberNames[item.attributedUserId] ?? 'Membro',
      itemKind: item.kind,
      itemName: item.name,
      itemTotalCents: item.unitPriceCents * item.quantity,
      commissionKind: item.commission.kind,
      commissionValue: item.commission.value,
      amountCents,
      liquidationStatus: 'pendente',
    })
    steps.push((tx) =>
      appendEventToTx(
        CommissionConfig,
        aggregateRef(CommissionConfig, input.orgId, commission.id),
        { _tag: 'commission.created', actorId: input.recordedByUid, payload: { data: commission } },
        tx,
      ),
    )
  }

  // cash_movement.created — the sale's cash-in (links the order + payment).
  const saleMovement = buildSaleMovement(
    {
      id: newId(),
      orgId: input.orgId,
      unitId: input.unitId,
      recordedByUid: input.recordedByUid,
      amountCents: order.totalCents,
      now: input.now,
    },
    input.orderId,
    input.paymentMethod,
  )
  steps.push((tx) =>
    appendEventToTx(
      CashMovementConfig,
      aggregateRef(CashMovementConfig, input.orgId, saleMovement.id),
      {
        _tag: 'cash_movement.created',
        actorId: input.recordedByUid,
        payload: { data: saleMovement },
      },
      tx,
    ),
  )

  // order.closed — the anchor (last). Flat payload, not `{ data }`.
  steps.push((tx) =>
    appendEventToTx(
      OrderConfig,
      aggregateRef(OrderConfig, input.orgId, input.orderId),
      {
        _tag: 'order.closed',
        actorId: input.recordedByUid,
        payload: {
          closedAt: input.now,
          subtotalCents: order.subtotalCents,
          totalCents: order.totalCents,
          paymentMethod: input.paymentMethod,
        },
      },
      tx,
    ),
  )

  const outcome = await commitSaga(steps)
  if (!outcome.ok) {
    throw new Error(`seedClosedSale cascade failed for ${input.orderId}: ${outcome.error}`)
  }
  return input.orderId
}
