import { CashMovement, Commission, Order, Subscription } from '@/domain'
import {
  type CashMovementRow,
  rowToDoc as cashMovementRowToDoc,
} from '@/shared/db/pg/effect/cash-movement-projector'
import {
  type CommissionRow,
  rowToDoc as commissionRowToDoc,
} from '@/shared/db/pg/effect/commission-projector'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)
const decodeCommission = Schema.decodeUnknownSync(Commission)
const decodeCashMovement = Schema.decodeUnknownSync(CashMovement)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

export async function loadOpenOrdersForOrg(orgId: string): Promise<Order[]> {
  const rows = await readUnderRls<OrderRow>(orgId, (client) =>
    client
      .query<OrderRow>("SELECT * FROM orders WHERE org_id = $1 AND status = 'open'", [orgId])
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeOrder(orderRowToDoc(row)))
}

export async function loadOrderById(orgId: string, orderId: string): Promise<Order | null> {
  const rows = await readUnderRls<OrderRow>(orgId, (client) =>
    client
      .query<OrderRow>('SELECT * FROM orders WHERE org_id = $1 AND id = $2', [orgId, orderId])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeOrder(orderRowToDoc(row)) : null
}

export async function findOpenOrderIdForAppointment(
  orgId: string,
  appointmentId: string,
): Promise<string | null> {
  const rows = await readUnderRls<Pick<OrderRow, 'id'>>(orgId, (client) =>
    client
      .query<
        Pick<OrderRow, 'id'>
      >("SELECT id FROM orders WHERE org_id = $1 AND appointment_id = $2 AND status = 'open' LIMIT 1", [orgId, appointmentId])
      .then((res) => res.rows),
  )
  return rows[0]?.id ?? null
}

export async function loadClosedOrdersByAppointmentForOrg(
  orgId: string,
): Promise<Map<string, Order>> {
  const rows = await readUnderRls<OrderRow>(orgId, (client) =>
    client
      .query<OrderRow>(
        "SELECT * FROM orders WHERE org_id = $1 AND status = 'closed' AND appointment_id IS NOT NULL",
        [orgId],
      )
      .then((res) => res.rows),
  )
  const byAppointment = new Map<string, Order>()
  for (const row of rows) {
    const order = decodeOrder(orderRowToDoc(row))
    if (order.appointmentId) byAppointment.set(order.appointmentId, order)
  }
  return byAppointment
}

export async function loadCommissionsForOrder(
  orgId: string,
  orderId: string,
): Promise<Commission[]> {
  const rows = await readUnderRls<CommissionRow>(orgId, (client) =>
    client
      .query<CommissionRow>('SELECT * FROM commissions WHERE org_id = $1 AND order_id = $2', [
        orgId,
        orderId,
      ])
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeCommission(commissionRowToDoc(row)))
}

export async function loadSaleMovementForOrder(
  orgId: string,
  orderId: string,
): Promise<CashMovement | null> {
  const rows = await readUnderRls<CashMovementRow>(orgId, (client) =>
    client
      .query<CashMovementRow>(
        "SELECT * FROM cash_movements WHERE org_id = $1 AND order_id = $2 AND kind = 'sale' LIMIT 1",
        [orgId, orderId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeCashMovement(cashMovementRowToDoc(row)) : null
}

export async function loadActiveSubscriptionForCustomer(
  orgId: string,
  customerId: string,
): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(
        "SELECT * FROM subscriptions WHERE org_id = $1 AND customer_id = $2 AND status = 'active' LIMIT 1",
        [orgId, customerId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

export async function loadActiveSubscriptionId(
  orgId: string,
  customerId: string,
): Promise<string | null> {
  const rows = await readUnderRls<Pick<SubscriptionRow, 'id'>>(orgId, (client) =>
    client
      .query<
        Pick<SubscriptionRow, 'id'>
      >("SELECT id FROM subscriptions WHERE org_id = $1 AND customer_id = $2 AND status = 'active' LIMIT 1", [orgId, customerId])
      .then((res) => res.rows),
  )
  return rows[0]?.id ?? null
}
