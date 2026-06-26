import { type BillingCycle } from '@/domain'
import { listCustomersForOrg } from '@/shared/org/customer-read'
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

// Lightweight loaders pra alimentar o form de criar assinatura sem expor
// uma server action RPC (chamados apenas em server components).
export async function loadCustomersAndPlans(
  orgId: string,
): Promise<{ customers: CustomerLite[]; plans: PlanLite[] }> {
  const [customers, plans] = await Promise.all([
    listCustomersForOrg(orgId),
    // Backend-aware (brief 0060, Grupo B): Postgres typed table under RLS or the
    // Firestore subcollection, both ordered by name.
    listSubscriptionPlansForOrg(orgId),
  ])
  return {
    customers: customers
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      .map((c) => ({ id: c.id, name: c.name })),
    plans: plans
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
