import { BillingPanel } from '@/features/billing/ui/BillingPanel'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getOrgBilling } from '@/shared/org/billing-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

// Plano e cobrança — the self-service billing surface for the Assinatura Oilio
// (brief 0073, AC-03). Reads the current org_billing state (Free default when
// no row) plus the live unit count, and hands it to the client panel. Only the
// owner can act (subscribe/portal); manager sees the read-only view.
export default async function BillingSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const [billing, units] = await Promise.all([
    getOrgBilling(ctx.membership.orgId),
    listUnitsForOrg(ctx.membership.orgId),
  ])

  return (
    <Main width="narrow" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Plano e cobrança</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Veja seu plano atual, quantas unidades estão sendo cobradas e gerencie sua assinatura do
          Oilio.
        </p>
      </header>

      <BillingPanel
        tier={billing.tier}
        status={billing.status}
        billingCycle={billing.billingCycle}
        unitQuantity={billing.unitQuantity}
        unitCount={units.length}
        currentPeriodEnd={billing.currentPeriodEnd}
        cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
        hasStripeCustomer={billing.stripeCustomerId !== null}
        canManageBilling={ctx.membership.role === 'owner'}
      />
    </Main>
  )
}
