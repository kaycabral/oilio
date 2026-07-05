import { BillingPanel } from '@/features/billing/ui/BillingPanel'
import { settingsSectionMeta } from '@/features/settings/ui/settings-sections'
import { getDefaultPaymentMethod, listRecentInvoices } from '@/shared/billing/billing-details'
import { track } from '@/shared/lib/track'
import { getOrgBilling } from '@/shared/org/billing-read'
import { requireManagerPage } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { SettingsSection } from '@cbrl/design'

// Cobrança — the self-service billing surface for the Assinatura Oilio (brief
// 0073, AC-03; moved under /settings by brief 0090). Reads the current
// org_billing state (Free default when no row) plus the live unit count, and
// hands it to the client panel. Only the owner can act (subscribe/portal);
// manager sees the read-only view.
//
// Route lives under `/settings/billing` and is reached via the Configurações
// modal (UserMenu → Cobrança). The app is context-based: billing follows the
// active Negócio automatically, so it belongs with the user's own settings
// surfaces rather than the operational sidebar (brief 0090).
export default async function BillingPage() {
  // Owner/manager only — exposes tier, billed units and billing period. The nav
  // hides it from non-managers; this is the server wall. Manager sees the
  // read-only view; only the owner gets the subscribe/portal actions below.
  const ctx = await requireManagerPage()

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: ctx.session.uid,
    section: 'billing',
  })

  const [billing, units, org] = await Promise.all([
    getOrgBilling(ctx.membership.orgId),
    listUnitsForOrg(ctx.membership.orgId),
    getOrg(ctx.membership.orgId),
  ])

  // Payment method + invoices live in Stripe (not projected into org_billing) —
  // fetch them only when there's a customer, in parallel, best-effort (each read
  // degrades to null/[] on failure). Free/no-customer orgs skip the round-trips.
  const [paymentMethod, invoices] = billing.stripeCustomerId
    ? await Promise.all([
        getDefaultPaymentMethod(billing.stripeCustomerId),
        listRecentInvoices(billing.stripeCustomerId),
      ])
    : [null, []]

  const meta = settingsSectionMeta('billing')
  return (
    <SettingsSection title={meta.label} description={meta.description}>
      <BillingPanel
        tier={billing.tier}
        status={billing.status}
        billingCycle={billing.billingCycle}
        unitQuantity={billing.unitQuantity}
        unitCount={units.length}
        orgName={org?.name ?? null}
        currentPeriodEnd={billing.currentPeriodEnd}
        cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
        hasStripeCustomer={billing.stripeCustomerId !== null}
        canManageBilling={ctx.membership.role === 'owner'}
        paymentMethod={paymentMethod}
        invoices={invoices}
      />
    </SettingsSection>
  )
}
