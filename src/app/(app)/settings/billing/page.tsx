import { BillingPanel } from '@/features/billing/ui/BillingPanel'
import { settingsSectionMeta } from '@/features/settings/core/settings-sections'
import { getDefaultPaymentMethod, listRecentInvoices } from '@/shared/billing/billing-details'
import { track } from '@/shared/lib/track'
import { getOrgBilling } from '@/shared/org/billing-read'
import { hasMembershipCapability, requireManagerPage } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { SettingsSection } from '@cbrl/design'

export const instant = false

export default async function BillingPage() {
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
        canManageBilling={hasMembershipCapability(ctx.membership, 'canManageBilling')}
        paymentMethod={paymentMethod}
        invoices={invoices}
      />
    </SettingsSection>
  )
}
