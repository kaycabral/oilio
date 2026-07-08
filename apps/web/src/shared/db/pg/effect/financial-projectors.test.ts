import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { CashMovementConfig } from '@/domain/aggregates/cash-movement/config'
import { ChargeConfig } from '@/domain/aggregates/charge/config'
import { CommissionConfig } from '@/domain/aggregates/commission/config'
import { OrderConfig } from '@/domain/aggregates/order/config'
import { aggregateRef } from '@/domain/effect'
import type { Appointment } from '@/domain/types/appointment'
import type { CashMovement } from '@/domain/types/cash-movement'
import type { Charge } from '@/domain/types/charge'
import type { Commission } from '@/domain/types/commission'
import type { Order } from '@/domain/types/order'
import type { Subscription } from '@/domain/types/subscription'
import { describe, expect, it } from 'vitest'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from './appointment-projector'
import {
  CASH_MOVEMENT_COLUMNS,
  cashMovementColumnValues,
  rowToDoc as cashMovementRowToDoc,
  type CashMovementRow,
} from './cash-movement-projector'
import {
  CHARGE_COLUMNS,
  chargeColumnValues,
  rowToDoc as chargeRowToDoc,
  type ChargeRow,
} from './charge-projector'
import {
  COMMISSION_COLUMNS,
  commissionColumnValues,
  rowToDoc as commissionRowToDoc,
  type CommissionRow,
} from './commission-projector'
import {
  ORDER_COLUMNS,
  orderColumnValues,
  rowToDoc as orderRowToDoc,
  type OrderRow,
} from './order-projector'
import {
  SUBSCRIPTION_COLUMNS,
  subscriptionColumnValues,
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from './subscription-projector'

/**
 * Pure-mapping unit tests for the financial-core typed projectors (brief 0061,
 * Feature E). Mirror `config-projectors.test.ts`: exercise `*ColumnValues`
 * (domain → ordered SQL row) and `rowToDoc` (row → reducer doc) WITHOUT a
 * database — the runtime upsert + the E2E seed both go through `*ColumnValues`,
 * so this pins the column count/order and the round-trip shape. The DB-level
 * routing/constraints/RLS are proven by the `*.events.pg.integration.test.ts`
 * suite. The invariant: a row built from `*ColumnValues`, read back as a `*Row`,
 * and passed through `rowToDoc` reconstructs the domain fields.
 */

function valueAt(columns: readonly string[], values: readonly unknown[], col: string): unknown {
  return values[columns.indexOf(col)]
}
// Reads a nullable-text column out of the ordered values as `string | null`
// WITHOUT an unsafe assertion — the projector only ever places a string or null
// there, and a non-string coerces to null (which the `*Row` shape accepts).
function textAt(
  columns: readonly string[],
  values: readonly unknown[],
  col: string,
): string | null {
  const v = valueAt(columns, values, col)
  return typeof v === 'string' ? v : null
}
function asPgBigint(v: unknown): string {
  return String(v)
}
function asPgJsonb(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v
}

describe('order projector — pure mapping', () => {
  const order: Order = {
    id: 'ord-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    customerId: 'cust-1',
    appointmentId: null,
    status: 'closed',
    items: [
      {
        id: 'it-1',
        kind: 'service',
        refId: 'svc-1',
        name: 'Corte',
        quantity: 1,
        unitPriceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        attributedUserId: 'user-1',
      },
    ],
    discountCents: 0,
    subtotalCents: 5000,
    totalCents: 5000,
    closedAt: '2026-06-01T12:00:00.000Z',
    paymentMethod: 'pix',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }

  function orderRow(version: number): OrderRow {
    const v = orderColumnValues(order, aggregateRef(OrderConfig, 'org-1', 'ord-1'), version)
    const at = (c: string): unknown => valueAt(ORDER_COLUMNS, v, c)
    return {
      org_id: order.orgId,
      id: order.id,
      unit_id: order.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      customer_id: order.customerId,
      appointment_id: order.appointmentId,
      status: order.status,
      closed_at: textAt(ORDER_COLUMNS, v, 'closed_at'),
      payment_method: textAt(ORDER_COLUMNS, v, 'payment_method'),
      discount_cents: asPgBigint(at('discount_cents')),
      subtotal_cents: asPgBigint(at('subtotal_cents')),
      total_cents: asPgBigint(at('total_cents')),
      items: asPgJsonb(at('items')),
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    }
  }

  it('columnValues has one value per column; closed carries payment + closedAt', () => {
    const v = orderColumnValues(order, aggregateRef(OrderConfig, 'org-1', 'ord-1'), 3)
    expect(v).toHaveLength(ORDER_COLUMNS.length)
    expect(v[ORDER_COLUMNS.indexOf('status')]).toBe('closed')
    expect(v[ORDER_COLUMNS.indexOf('payment_method')]).toBe('pix')
    expect(v[ORDER_COLUMNS.indexOf('closed_at')]).toBe('2026-06-01T12:00:00.000Z')
  })

  it('rowToDoc round-trips status/totals/items (+ _version)', () => {
    const doc = orderRowToDoc(orderRow(3))
    expect(doc).toMatchObject({
      _version: 3,
      id: 'ord-1',
      status: 'closed',
      paymentMethod: 'pix',
      totalCents: 5000,
      customerId: 'cust-1',
    })
    expect(Array.isArray(doc['items'])).toBe(true)
  })

  it('an open order projects null payment + null closedAt', () => {
    const open: Order = {
      ...order,
      status: 'open',
      closedAt: null,
      paymentMethod: null,
    }
    const v = orderColumnValues(open, aggregateRef(OrderConfig, 'org-1', 'ord-1'), 1)
    expect(v[ORDER_COLUMNS.indexOf('payment_method')]).toBeNull()
    expect(v[ORDER_COLUMNS.indexOf('closed_at')]).toBeNull()
  })
})

describe('commission projector — pure mapping', () => {
  const commission: Commission = {
    id: 'com-1',
    orgId: 'org-1',
    orderId: 'ord-1',
    orderItemId: 'it-1',
    attributedUserId: 'user-1',
    attributedMemberName: 'Zé',
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: 5000,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    createdAt: '2026-06-01T12:00:00.000Z',
  }

  function commissionRow(version: number, overrides: Partial<CommissionRow> = {}): CommissionRow {
    const v = commissionColumnValues(
      commission,
      aggregateRef(CommissionConfig, 'org-1', 'com-1'),
      version,
    )
    const at = (c: string): unknown => valueAt(COMMISSION_COLUMNS, v, c)
    return {
      org_id: commission.orgId,
      id: commission.id,
      last_event_version: asPgBigint(at('last_event_version')),
      order_id: commission.orderId,
      order_item_id: commission.orderItemId,
      attributed_user_id: commission.attributedUserId,
      attributed_member_name: commission.attributedMemberName,
      item_kind: commission.itemKind,
      item_name: commission.itemName,
      item_total_cents: asPgBigint(at('item_total_cents')),
      commission_kind: commission.commissionKind,
      commission_value: asPgBigint(at('commission_value')),
      amount_cents: asPgBigint(at('amount_cents')),
      liquidation_status: textAt(COMMISSION_COLUMNS, v, 'liquidation_status') ?? 'pendente',
      paid_at: textAt(COMMISSION_COLUMNS, v, 'paid_at'),
      payment_proof: textAt(COMMISSION_COLUMNS, v, 'payment_proof'),
      created_at: commission.createdAt,
      ...overrides,
    }
  }

  it('a pending commission normalizes status + null paid_at', () => {
    const v = commissionColumnValues(
      commission,
      aggregateRef(CommissionConfig, 'org-1', 'com-1'),
      1,
    )
    expect(v).toHaveLength(COMMISSION_COLUMNS.length)
    expect(v[COMMISSION_COLUMNS.indexOf('liquidation_status')]).toBe('pendente')
    expect(v[COMMISSION_COLUMNS.indexOf('paid_at')]).toBeNull()
  })

  it('a paid commission carries its paid_at', () => {
    const paid: Commission = {
      ...commission,
      liquidationStatus: 'pago',
      paidAt: '2026-06-02T00:00:00.000Z',
    }
    const v = commissionColumnValues(paid, aggregateRef(CommissionConfig, 'org-1', 'com-1'), 2)
    expect(v[COMMISSION_COLUMNS.indexOf('liquidation_status')]).toBe('pago')
    expect(v[COMMISSION_COLUMNS.indexOf('paid_at')]).toBe('2026-06-02T00:00:00.000Z')
  })

  it('rowToDoc round-trips the ledger fields (+ _version)', () => {
    const doc = commissionRowToDoc(commissionRow(4))
    expect(doc).toMatchObject({
      _version: 4,
      id: 'com-1',
      attributedUserId: 'user-1',
      amountCents: 2500,
      liquidationStatus: 'pendente',
    })
  })

  it('a paid commission with no paidAt falls back to null (defensive branch)', () => {
    // liquidationStatusOf returns "pago" but the optional paidAt is absent — the
    // column-values guard yields null rather than undefined.
    const paidNoDate = { ...commission, liquidationStatus: 'pago' as const, paidAt: undefined }
    const v = commissionColumnValues(
      paidNoDate,
      aggregateRef(CommissionConfig, 'org-1', 'com-1'),
      1,
    )
    expect(v[COMMISSION_COLUMNS.indexOf('liquidation_status')]).toBe('pago')
    expect(v[COMMISSION_COLUMNS.indexOf('paid_at')]).toBeNull()
  })
})

describe('cash-movement projector — pure mapping', () => {
  const sale: CashMovement = {
    id: 'cm-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    kind: 'sale',
    direction: 'in',
    amountCents: 5000,
    paymentMethod: 'pix',
    description: null,
    orderId: 'ord-1',
    expenseCategoryId: null,
    recordedByUid: 'user-1',
    createdAt: '2026-06-01T12:00:00.000Z',
  }

  function saleRow(version: number): CashMovementRow {
    const v = cashMovementColumnValues(
      sale,
      aggregateRef(CashMovementConfig, 'org-1', 'cm-1'),
      version,
    )
    const at = (c: string): unknown => valueAt(CASH_MOVEMENT_COLUMNS, v, c)
    return {
      org_id: sale.orgId,
      id: sale.id,
      unit_id: sale.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      kind: sale.kind,
      direction: sale.direction,
      amount_cents: asPgBigint(at('amount_cents')),
      payment_method: textAt(CASH_MOVEMENT_COLUMNS, v, 'payment_method'),
      order_id: textAt(CASH_MOVEMENT_COLUMNS, v, 'order_id'),
      expense_category_id: textAt(CASH_MOVEMENT_COLUMNS, v, 'expense_category_id'),
      description: sale.description,
      recorded_by_uid: sale.recordedByUid,
      created_at: sale.createdAt,
    }
  }

  it('a sale carries orderId + paymentMethod; no expenseCategoryId', () => {
    const v = cashMovementColumnValues(sale, aggregateRef(CashMovementConfig, 'org-1', 'cm-1'), 1)
    expect(v).toHaveLength(CASH_MOVEMENT_COLUMNS.length)
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('kind')]).toBe('sale')
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('order_id')]).toBe('ord-1')
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('expense_category_id')]).toBeNull()
  })

  it('a sangria has no order/payment links', () => {
    const sangria: CashMovement = {
      id: 'cm-2',
      orgId: 'org-1',
      unitId: 'unit-1',
      kind: 'sangria',
      direction: 'out',
      amountCents: 1000,
      paymentMethod: null,
      description: 'caixa',
      orderId: null,
      expenseCategoryId: null,
      recordedByUid: 'user-1',
      createdAt: '2026-06-01T12:00:00.000Z',
    }
    const v = cashMovementColumnValues(
      sangria,
      aggregateRef(CashMovementConfig, 'org-1', 'cm-2'),
      1,
    )
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('order_id')]).toBeNull()
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('payment_method')]).toBeNull()
  })

  it('rowToDoc round-trips the sale (+ _version)', () => {
    const doc = cashMovementRowToDoc(saleRow(2))
    expect(doc).toMatchObject({
      _version: 2,
      id: 'cm-1',
      kind: 'sale',
      direction: 'in',
      orderId: 'ord-1',
      paymentMethod: 'pix',
    })
  })

  it('a despesa carries no paymentMethod (the non-sale branch)', () => {
    const despesa: CashMovement = {
      id: 'cm-3',
      orgId: 'org-1',
      unitId: 'unit-1',
      kind: 'despesa',
      direction: 'out',
      amountCents: 2000,
      paymentMethod: null,
      description: 'aluguel',
      orderId: null,
      expenseCategoryId: 'cat-1',
      recordedByUid: 'user-1',
      createdAt: '2026-06-01T12:00:00.000Z',
    }
    const v = cashMovementColumnValues(
      despesa,
      aggregateRef(CashMovementConfig, 'org-1', 'cm-3'),
      1,
    )
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('payment_method')]).toBeNull()
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('expense_category_id')]).toBe('cat-1')
  })

  it('a sale_reversal keeps its paymentMethod (the sale-branch, out direction)', () => {
    const reversal: CashMovement = {
      ...sale,
      id: 'cm-4',
      kind: 'sale_reversal',
      direction: 'out',
    }
    const v = cashMovementColumnValues(
      reversal,
      aggregateRef(CashMovementConfig, 'org-1', 'cm-4'),
      1,
    )
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('kind')]).toBe('sale_reversal')
    expect(v[CASH_MOVEMENT_COLUMNS.indexOf('payment_method')]).toBe('pix')
  })
})

describe('charge projector — pure mapping', () => {
  const charge: Charge = {
    id: 'chg-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    subscriptionId: 'sub-1',
    customerId: 'cust-1',
    amountCents: 9900,
    periodStartAt: '2026-06-01T00:00:00.000Z',
    periodEndAt: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-06-01T00:00:00.000Z',
    status: 'scheduled',
    attempts: 0,
    paidAt: null,
    failedAt: null,
    failureReason: null,
    refundedAt: null,
    lastActorUid: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function chargeRow(version: number): ChargeRow {
    const v = chargeColumnValues(charge, aggregateRef(ChargeConfig, 'org-1', 'chg-1'), version)
    const at = (c: string): unknown => valueAt(CHARGE_COLUMNS, v, c)
    return {
      org_id: charge.orgId,
      id: charge.id,
      unit_id: charge.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      subscription_id: charge.subscriptionId,
      customer_id: charge.customerId,
      amount_cents: asPgBigint(at('amount_cents')),
      period_start_at: charge.periodStartAt,
      period_end_at: charge.periodEndAt,
      due_date: charge.dueDate,
      status: charge.status,
      attempts: asPgBigint(at('attempts')),
      paid_at: charge.paidAt,
      failed_at: charge.failedAt,
      failure_reason: charge.failureReason,
      refunded_at: charge.refundedAt,
      last_actor_uid: charge.lastActorUid,
      created_at: charge.createdAt,
      updated_at: charge.updatedAt,
    }
  }

  it('columnValues has one value per column; status scheduled', () => {
    const v = chargeColumnValues(charge, aggregateRef(ChargeConfig, 'org-1', 'chg-1'), 1)
    expect(v).toHaveLength(CHARGE_COLUMNS.length)
    expect(v[CHARGE_COLUMNS.indexOf('status')]).toBe('scheduled')
    expect(v[CHARGE_COLUMNS.indexOf('subscription_id')]).toBe('sub-1')
  })

  it('rowToDoc round-trips the charge (+ _version)', () => {
    const doc = chargeRowToDoc(chargeRow(2))
    expect(doc).toMatchObject({
      _version: 2,
      id: 'chg-1',
      subscriptionId: 'sub-1',
      amountCents: 9900,
      status: 'scheduled',
      attempts: 0,
    })
  })

  it('a paid/failed charge round-trips its lifecycle fields', () => {
    const paid: Charge = {
      ...charge,
      status: 'paid',
      attempts: 1,
      paidAt: '2026-06-02T00:00:00.000Z',
    }
    const v = chargeColumnValues(paid, aggregateRef(ChargeConfig, 'org-1', 'chg-1'), 3)
    expect(v[CHARGE_COLUMNS.indexOf('status')]).toBe('paid')
    expect(v[CHARGE_COLUMNS.indexOf('paid_at')]).toBe('2026-06-02T00:00:00.000Z')

    const failed: Charge = {
      ...charge,
      status: 'failed',
      attempts: 2,
      failedAt: '2026-06-02T00:00:00.000Z',
      failureReason: 'card_declined',
    }
    const fv = chargeColumnValues(failed, aggregateRef(ChargeConfig, 'org-1', 'chg-1'), 4)
    expect(fv[CHARGE_COLUMNS.indexOf('failure_reason')]).toBe('card_declined')
  })
})

describe('subscription projector — pure mapping', () => {
  const subscription: Subscription = {
    id: 'sub-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    customerId: 'cust-1',
    customerUserId: 'user-9',
    plan: {
      planId: 'plan-1',
      name: 'Mensal',
      priceCents: 9900,
      billingCycle: 'monthly',
      includedItemIds: ['svc-1'],
      includedCategoryIds: [],
      usageLimit: { kind: 'count', quantity: 4 },
    },
    status: 'active',
    currentPeriod: {
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-07-01T00:00:00.000Z',
      consumed: 1,
    },
    cancelAtPeriodEnd: false,
    nextChargeDate: '2026-07-01T00:00:00.000Z',
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function subscriptionRow(version: number): SubscriptionRow {
    const v = subscriptionColumnValues(subscription, version)
    const at = (c: string): unknown => valueAt(SUBSCRIPTION_COLUMNS, v, c)
    return {
      org_id: subscription.orgId,
      id: subscription.id,
      unit_id: subscription.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      customer_id: subscription.customerId,
      customer_user_id: subscription.customerUserId,
      status: subscription.status,
      billing_cycle: textAt(SUBSCRIPTION_COLUMNS, v, 'billing_cycle') ?? 'monthly',
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
      next_charge_date: subscription.nextChargeDate,
      past_due_cycles: asPgBigint(at('past_due_cycles')),
      past_due_threshold: asPgBigint(at('past_due_threshold')),
      cancellation_reason: subscription.cancellationReason,
      cancelled_at: subscription.cancelledAt,
      plan: asPgJsonb(at('plan')),
      current_period: asPgJsonb(at('current_period')),
      created_at: subscription.createdAt,
      updated_at: subscription.updatedAt,
    }
  }

  it('billing_cycle is lifted from the plan snapshot to its column', () => {
    const v = subscriptionColumnValues(subscription, 1)
    expect(v).toHaveLength(SUBSCRIPTION_COLUMNS.length)
    expect(v[SUBSCRIPTION_COLUMNS.indexOf('billing_cycle')]).toBe('monthly')
    expect(v[SUBSCRIPTION_COLUMNS.indexOf('status')]).toBe('active')
  })

  it('rowToDoc round-trips status + plan snapshot (+ _version)', () => {
    const doc = subscriptionRowToDoc(subscriptionRow(5))
    expect(doc).toMatchObject({
      _version: 5,
      id: 'sub-1',
      status: 'active',
      customerUserId: 'user-9',
      pastDueThreshold: 2,
    })
    expect(doc['plan']).toMatchObject({ planId: 'plan-1', billingCycle: 'monthly' })
    expect(doc['currentPeriod']).toMatchObject({ consumed: 1 })
  })
})

describe('appointment projector — pure mapping', () => {
  const appointment: Appointment = {
    id: 'apt-1',
    orgId: 'org-1',
    unitId: 'unit-1',
    memberOperationId: 'pro-1',
    customerId: 'cust-1',
    serviceId: 'svc-1',
    startAt: '2026-06-10T14:00:00.000Z',
    endAt: '2026-06-10T14:30:00.000Z',
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: { kind: 'percentage', value: 50 },
    cancellationPolicySnapshot: null,
    customerUserId: 'user-9',
    memberOperatorUserId: 'user-1',
    attribution: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function appointmentRow(version: number, withTracking: boolean): AppointmentRow {
    const source: Appointment = withTracking
      ? {
          ...appointment,
          status: 'cancelled',
          cancelledAt: '2026-06-05T00:00:00.000Z',
          cancelledBy: 'system',
          cancelledNoticeMinutes: 120,
        }
      : appointment
    const v = appointmentColumnValues(
      source,
      aggregateRef(AppointmentConfig, 'org-1', 'apt-1'),
      version,
    )
    const at = (c: string): unknown => valueAt(APPOINTMENT_COLUMNS, v, c)
    return {
      org_id: source.orgId,
      id: source.id,
      unit_id: source.unitId,
      last_event_version: asPgBigint(at('last_event_version')),
      member_operation_id: source.memberOperationId,
      customer_id: source.customerId,
      service_id: source.serviceId,
      customer_user_id: source.customerUserId,
      member_operator_user_id: source.memberOperatorUserId,
      start_at: source.startAt,
      end_at: source.endAt,
      status: source.status,
      service_price_cents_snapshot: asPgBigint(at('service_price_cents_snapshot')),
      service_duration_minutes_snapshot: asPgBigint(at('service_duration_minutes_snapshot')),
      commission_snapshot: at('commission_snapshot'),
      cancellation_policy_snapshot: at('cancellation_policy_snapshot'),
      tracking: asPgJsonb(at('tracking')),
      attribution: asPgJsonb(at('attribution')),
      created_at: source.createdAt,
      updated_at: source.updatedAt,
    }
  }

  it('columnValues has one value per column; unit_id is a real column (RLS)', () => {
    const v = appointmentColumnValues(
      appointment,
      aggregateRef(AppointmentConfig, 'org-1', 'apt-1'),
      1,
    )
    expect(v).toHaveLength(APPOINTMENT_COLUMNS.length)
    expect(v[APPOINTMENT_COLUMNS.indexOf('unit_id')]).toBe('unit-1')
    expect(v[APPOINTMENT_COLUMNS.indexOf('status')]).toBe('scheduled')
  })

  it('a scheduled appointment has an empty tracking blob (no stray keys)', () => {
    const doc = appointmentRowToDoc(appointmentRow(1, false))
    expect(doc).toMatchObject({ _version: 1, id: 'apt-1', status: 'scheduled', unitId: 'unit-1' })
    expect(doc['cancelledAt']).toBeUndefined()
    expect(doc['cancelledBy']).toBeUndefined()
  })

  it('a cancelled appointment round-trips its tracking fields', () => {
    const doc = appointmentRowToDoc(appointmentRow(2, true))
    expect(doc).toMatchObject({
      _version: 2,
      status: 'cancelled',
      cancelledBy: 'system',
      cancelledNoticeMinutes: 120,
    })
  })

  it('a NULL tracking blob round-trips to no tracking keys', () => {
    const row = appointmentRow(1, false)
    const doc = appointmentRowToDoc({ ...row, tracking: null })
    expect(doc).toMatchObject({ _version: 1, id: 'apt-1', status: 'scheduled' })
    expect(doc['cancelledAt']).toBeUndefined()
  })
})
