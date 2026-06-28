import { BillingPanel } from '@/features/billing/ui/BillingPanel'
import { getOrgBilling } from '@/shared/org/billing-read'
import { requireManagerPage } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { Main } from '@cbrl/design'

// Plano e cobrança — the self-service billing surface for the Assinatura Oilio
// (brief 0073, AC-03). Reads the current org_billing state (Free default when
// no row) plus the live unit count, and hands it to the client panel. Only the
// owner can act (subscribe/portal); manager sees the read-only view.
//
// Route lives at top-level `/billing` (not under `/settings`): the Assinatura
// Oilio is PER-NEGÓCIO, so it sits with the other org-admin surfaces
// (`/organizations`, `/team`), while `/settings/*` stays the user's own area
// (profile, privacy). See the nav "Administração" section.
export default async function BillingPage() {
  // Owner/manager only — exposes tier, billed units and billing period. The nav
  // hides it from non-managers; this is the server wall. Manager sees the
  // read-only view; only the owner gets the subscribe/portal actions below.
  const ctx = await requireManagerPage()

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
