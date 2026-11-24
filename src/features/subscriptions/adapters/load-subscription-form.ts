import { type BillingCycle } from '@/domain'
import { listActiveCustomersForOrg } from '@/shared/org/customer-read'
import { listSubscriptionPlansForOrg } from '@/shared/org/subscription-plan-read'
import 'server-only'

export type CustomerLite = { id: string; name: string }
export type PlanLite = {
  id: string
  name: string
  priceCents: number
  billingCycle: BillingCycle
  active: boolean
}

export async function loadCustomersAndPlans(
  orgId: string,
): Promise<{ customers: CustomerLite[]; plans: PlanLite[] }> {
  const [customers, plans] = await Promise.all([
    listActiveCustomersForOrg(orgId),
    listSubscriptionPlansForOrg(orgId),
  ])
  return {
    customers: customers
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      .map((c) => ({ id: c.id, name: c.name })),
    plans: plans
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
