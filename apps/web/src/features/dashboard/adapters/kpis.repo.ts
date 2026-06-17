import { Appointment, Order, Subscription } from '@/domain'
import type { DashboardFilters } from '@/features/dashboard/core/filters'
import {
  type DashboardKpis,
  computeOccupancyPct,
  subscriptionMrrCents,
  sumOrderTotals,
} from '@/features/dashboard/core/kpis'
import { scopeByUnit } from '@/features/dashboard/core/scope'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import 'server-only'

type QueryWindow = {
  fromUtc: string
  toUtcExclusive: string
  unitId: string | null
}

async function loadClosedOrdersInWindow(tenantId: string, win: QueryWindow): Promise<Order[]> {
  const base = getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('orders')
    .withConverter(fsConverter(Order))
  const q = base
    .where('status', '==', 'closed')
    .where('closedAt', '>=', win.fromUtc)
    .where('closedAt', '<', win.toUtcExclusive)
    .where('unitId', '==', win.unitId)
  const snap = await q.get()
  return snap.docs.map((d) => d.data())
}

async function loadAppointmentsInWindow(
  tenantId: string,
  win: QueryWindow,
): Promise<Appointment[]> {
  const base = getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
  const q = base
    .where('startAt', '>=', win.fromUtc)
    .where('startAt', '<', win.toUtcExclusive)
    .where('unitId', '==', win.unitId)
  const snap = await q.get()
  return snap.docs.map((d) => d.data())
}

export async function loadDashboardKpis(
  tenantId: string,
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

  const subsBase = getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))

  // MRR/ARR/assinantes refletem só a unidade ativa (brief 0043, AC-03). A
  // assinatura é dona de uma unidade (`Subscription.unitId`, #1117), então o
  // filtro espelha o de orders/appointments via `scopeByUnit`.
  const subsByStatus = (status: Subscription['status']) =>
    scopeByUnit(subsBase.where('status', '==', status), filters.unitId)

  const [activeSubsSnap, recoveringSubsSnap, ordersCurrent, ordersPrev, apptsCurrent, apptsPrev] =
    await Promise.all([
      subsByStatus('active').get(),
      subsByStatus('past_due').get(),
      loadClosedOrdersInWindow(tenantId, currentWindow),
      loadClosedOrdersInWindow(tenantId, previousWindow),
      loadAppointmentsInWindow(tenantId, currentWindow),
      loadAppointmentsInWindow(tenantId, previousWindow),
    ])

  const activeSubs = [
    ...activeSubsSnap.docs.map((d) => d.data()),
    ...recoveringSubsSnap.docs.map((d) => d.data()),
  ]
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
