import { type BillingCycle, SubscriptionPlan } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listCustomersForTenant } from '@/shared/tenant/customer-read'
import 'server-only'

export type CustomerLite = { id: string; name: string }
export type PlanLite = {
  id: string
  name: string
  priceCents: number
  billingCycle: BillingCycle
  active: boolean
}

// Lightweight loaders pra alimentar o form de criar assinatura sem expor
// uma server action RPC (chamados apenas em server components).
export async function loadCustomersAndPlans(
  tenantId: string,
): Promise<{ customers: CustomerLite[]; plans: PlanLite[] }> {
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)
  const [customers, plansSnap] = await Promise.all([
    listCustomersForTenant(tenantId),
    tenantRef
      .collection('subscription_plans')
      .withConverter(fsConverter(SubscriptionPlan))
      .orderBy('name')
      .get(),
  ])
  return {
    customers: customers
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      .map((c) => ({ id: c.id, name: c.name })),
    plans: plansSnap.docs
      .map((d) => d.data())
      // Active + not archived (brief 0027, AC-06) — a retired plan can't back
      // a new subscription, but its snapshot still resolves historical ones.
      .filter((p) => p.active && !p.archivedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        billingCycle: p.billingCycle,
        active: p.active,
      })),
  }
}
