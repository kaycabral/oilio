import { Charge, Commission, Order, Subscription } from '@/domain'
import type { GoalPeriodWindow } from '@/features/copilot/core/tracking'
import { isActiveSubscription, subscriptionMrrCents } from '@/features/dashboard/core/kpis'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import 'server-only'

export type GoalActuals = {
  // Realizado = receita avulsa (order) + receita recorrente reconhecida (charge
  // liquidado no período), menos comissão. Tudo escopado à unidade ativa.
  revenueCents: number
  commissionCents: number
  // MRR da unidade — observação/projeção, NUNCA somado ao realizado (AC-08).
  // Snapshot point-in-time das assinaturas ativas.
  mrrCents: number
}

// Realizado inputs for the active unit. Revenue = closed orders (avulso) +
// settled subscription charges in the period (recorrente reconhecida, AC-08);
// commission is subtracted. MRR is computed separately as an observation — it
// is NOT recognized revenue and never enters the realizado.
export async function loadGoalActuals(
  tenantId: string,
  unitId: string,
  window: GoalPeriodWindow,
): Promise<GoalActuals> {
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)

  const ordersQ = tenantRef
    .collection('orders')
    .withConverter(fsConverter(Order))
    .where('status', '==', 'closed')
    .where('closedAt', '>=', window.fromIso)
    .where('closedAt', '<=', window.toIso)
    .where('unitId', '==', unitId)

  // Recurring recognized revenue: charges settled (paid) within the period,
  // scoped by the unit snapshot captured on the charge (`Charge.unitId`, #1117).
  const chargesQ = tenantRef
    .collection('charges')
    .withConverter(fsConverter(Charge))
    .where('status', '==', 'paid')
    .where('paidAt', '>=', window.fromIso)
    .where('paidAt', '<=', window.toIso)
    .where('unitId', '==', unitId)

  // MRR observation: active subscriptions owned by the unit.
  const subsQ = tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .where('unitId', '==', unitId)

  const [ordersSnap, chargesSnap, commsSnap, subsSnap] = await Promise.all([
    ordersQ.get(),
    chargesQ.get(),
    tenantRef
      .collection('commissions')
      .withConverter(fsConverter(Commission))
      .where('createdAt', '>=', window.fromIso)
      .where('createdAt', '<=', window.toIso)
      .get(),
    subsQ.get(),
  ])

  const orders = ordersSnap.docs.map((d) => d.data())
  const orderRevenueCents = orders.reduce((acc, o) => acc + o.totalCents, 0)

  const charges = chargesSnap.docs.map((d) => d.data())
  const recurringRevenueCents = charges.reduce((acc, c) => acc + c.amountCents, 0)

  // Commission has no `unitId` (it references the closing order), so unit-scoping
  // maps via the period's closed orders for this unit — mirrors reports.
  const orderIds = new Set(orders.map((o) => o.id))
  const commissions = commsSnap.docs.map((d) => d.data())
  const commissionCents = commissions
    .filter((c) => orderIds.has(c.orderId))
    .reduce((acc, c) => acc + c.amountCents, 0)

  const mrrCents = subsSnap.docs
    .map((d) => d.data())
    .filter(isActiveSubscription)
    .reduce((acc, s) => acc + subscriptionMrrCents(s), 0)

  return {
    revenueCents: orderRevenueCents + recurringRevenueCents,
    commissionCents,
    mrrCents,
  }
}
