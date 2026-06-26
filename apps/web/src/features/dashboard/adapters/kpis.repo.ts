import { Appointment, Order, Subscription } from '@/domain'
import type { DashboardFilters } from '@/features/dashboard/core/filters'
import {
  type DashboardKpis,
  computeOccupancyPct,
  subscriptionMrrCents,
  sumOrderTotals,
} from '@/features/dashboard/core/kpis'
import {
  type AppointmentRow,
  rowToDoc as apptRowToDoc,
} from '@/shared/db/pg/effect/appointment-projector'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import {
  type SubscriptionRow,
  rowToDoc as subscriptionRowToDoc,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrder = Schema.decodeUnknownSync(Order)
const decodeAppointment = Schema.decodeUnknownSync(Appointment)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// MRR/ARR/assinantes refletem só a unidade ativa (brief 0043, AC-03). A
// assinatura é dona de uma unidade (`Subscription.unitId`, #1117), então o
// filtro de unidade espelha o de orders/appointments — org-wide só quando não
// há unidade no contexto. Lê a projeção tipada sob RLS, escopada ao status +
// unidade, e decodifica pelo schema do domínio (sem cast).
async function loadSubscriptionsByStatus(
  orgId: string,
  status: Subscription['status'],
  unitId: string | null,
): Promise<Subscription[]> {
  const params: unknown[] = [orgId, status]
  let unitClause = ''
  if (unitId !== null) {
    params.push(unitId)
    unitClause = ` AND unit_id = $${params.length}`
  }
  const rows = await readUnderRls<SubscriptionRow>(
    orgId,
    (client) =>
      client
        .query<SubscriptionRow>(
          `SELECT * FROM subscriptions WHERE org_id = $1 AND status = $2${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    unitId ?? '',
  )
  return rows.map((r) => decodeSubscription(subscriptionRowToDoc(r)))
}

type QueryWindow = {
  fromUtc: string
  toUtcExclusive: string
  unitId: string | null
}

async function loadClosedOrdersInWindow(orgId: string, win: QueryWindow): Promise<Order[]> {
  const unitClause = win.unitId === null ? 'unit_id IS NULL' : 'unit_id = $4'
  const params: unknown[] = [orgId, win.fromUtc, win.toUtcExclusive]
  if (win.unitId !== null) params.push(win.unitId)
  const rows = await readUnderRls<OrderRow>(
    orgId,
    (client) =>
      client
        .query<OrderRow>(
          `SELECT * FROM orders
             WHERE org_id = $1 AND status = 'closed'
               AND closed_at >= $2 AND closed_at < $3 AND ${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    win.unitId ?? '',
  )
  return rows.map((r) => decodeOrder(orderRowToDoc(r)))
}

async function loadAppointmentsInWindow(orgId: string, win: QueryWindow): Promise<Appointment[]> {
  // UNIT-SCOPED (brief 0061 § Grupo C / AC-04): mirrors `loadClosedOrdersInWindow`
  // — the null unit is handled as `IS NULL` (no `$4` param) and `app.current_unit`
  // is pinned to `win.unitId ?? ''`.
  const unitClause = win.unitId === null ? 'unit_id IS NULL' : 'unit_id = $4'
  const params: unknown[] = [orgId, win.fromUtc, win.toUtcExclusive]
  if (win.unitId !== null) params.push(win.unitId)
  const rows = await readUnderRls<AppointmentRow>(
    orgId,
    (client) =>
      client
        .query<AppointmentRow>(
          `SELECT * FROM appointments
             WHERE org_id = $1 AND start_at >= $2 AND start_at < $3 AND ${unitClause}`,
          params,
        )
        .then((res) => res.rows),
    win.unitId ?? '',
  )
  return rows.map((r) => decodeAppointment(apptRowToDoc(r)))
}

export async function loadDashboardKpis(
  orgId: string,
  filters: DashboardFilters,
): Promise<DashboardKpis> {
  const currentWindow: QueryWindow = {
    fromUtc: filters.fromUtc,
    toUtcExclusive: filters.toUtcExclusive,
    unitId: filters.unitId,
  }
  const previousWindow: QueryWindow = {
    fromUtc: filters.previousFromUtc,
    toUtcExclusive: filters.previousToUtcExclusive,
    unitId: filters.unitId,
  }

  const [activeSubsRows, recoveringSubsRows, ordersCurrent, ordersPrev, apptsCurrent, apptsPrev] =
    await Promise.all([
      loadSubscriptionsByStatus(orgId, 'active', filters.unitId),
      loadSubscriptionsByStatus(orgId, 'past_due', filters.unitId),
      loadClosedOrdersInWindow(orgId, currentWindow),
      loadClosedOrdersInWindow(orgId, previousWindow),
      loadAppointmentsInWindow(orgId, currentWindow),
      loadAppointmentsInWindow(orgId, previousWindow),
    ])

  const activeSubs = [...activeSubsRows, ...recoveringSubsRows]
  const mrrCents = activeSubs.reduce((acc, s) => acc + subscriptionMrrCents(s), 0)

  const revenueCurrent = sumOrderTotals(ordersCurrent)
  const revenuePrev = sumOrderTotals(ordersPrev)
  const avgCurrent = ordersCurrent.length ? Math.round(revenueCurrent / ordersCurrent.length) : 0
  const avgPrev = ordersPrev.length ? Math.round(revenuePrev / ordersPrev.length) : 0

  return {
    // Snapshot — point-in-time, no comparison surface in V0.
    mrrCents: { value: mrrCents, previousValue: null },
    arrCents: { value: mrrCents * 12, previousValue: null },
    activeSubscribers: { value: activeSubs.length, previousValue: null },
    // Period-bound — comparison vs previous equal-length window.
    revenueCents: { value: revenueCurrent, previousValue: revenuePrev },
    occupancyPct: {
      value: computeOccupancyPct(apptsCurrent),
      previousValue: computeOccupancyPct(apptsPrev),
    },
    averageTicketCents: { value: avgCurrent, previousValue: avgPrev },
  }
}
