'use server'

import type { MessageTemplate } from '@/domain'
import type { BillingCycle, Tier } from '@/domain/billing/tiers'
import { listMessageTemplates } from '@/features/notifications/adapters/message-templates'
import type { InvoiceSummary, PaymentMethodSummary } from '@/shared/billing/billing-details'
import { getDefaultPaymentMethod, listRecentInvoices } from '@/shared/billing/billing-details'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import type { LinkedEstablishment } from '@/shared/identity/org-links'
import { listMyCustomerEstablishments } from '@/shared/identity/org-links'
import { track } from '@/shared/lib/track'
import { getOrgBilling } from '@/shared/org/billing-read'
import { getActiveOrgContext, hasMembershipCapability } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { listUnitsForOrg } from '@/shared/org/unit-read'

export type SettingsLoadResult<T> = { ok: true; data: T } | { ok: false; redirectTo: string }

async function requireMemberContext() {
  if (!isFirebaseConfigured()) return { ok: false as const, redirectTo: '/' }
  const session = await getSessionUser()
  if (!session) return { ok: false as const, redirectTo: '/login' }
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return { ok: false as const, redirectTo: '/onboarding' }
  return { ok: true as const, session, ctx }
}

export type ProfileSectionData = {
  defaultName: string
  defaultMobile: string
  defaultBirthDate: string
}

export async function loadProfileSection(): Promise<SettingsLoadResult<ProfileSectionData>> {
  const auth = await requireMemberContext()
  if (!auth.ok) return auth

  track('settings_section_viewed', {
    org_id: auth.ctx.membership.orgId,
    user_id: auth.session.uid,
    section: 'profile',
  })

  return {
    ok: true,
    data: {
      defaultName: auth.ctx.user.displayName ?? '',
      defaultMobile: auth.ctx.user.mobile ?? '',
      defaultBirthDate: auth.ctx.user.birthDate ?? '',
    },
  }
}

export type PrivacySectionData = {
  establishments: LinkedEstablishment[]
}

export async function loadPrivacySection(): Promise<SettingsLoadResult<PrivacySectionData>> {
  const auth = await requireMemberContext()
  if (!auth.ok) return auth

  track('settings_section_viewed', {
    org_id: auth.ctx.membership.orgId,
    user_id: auth.session.uid,
    section: 'privacy',
  })

  const establishments = await listMyCustomerEstablishments(auth.session.uid)
  return { ok: true, data: { establishments } }
}

export type NotificationsSectionData = {
  templates: MessageTemplate[]
  canManage: boolean
}

export async function loadNotificationsSection(): Promise<
  SettingsLoadResult<NotificationsSectionData>
> {
  const auth = await requireMemberContext()
  if (!auth.ok) return auth

  track('settings_section_viewed', {
    org_id: auth.ctx.membership.orgId,
    user_id: auth.session.uid,
    section: 'notifications',
  })

  const canManage = auth.ctx.membership.role === 'owner' || auth.ctx.membership.role === 'manager'
  const templates = await listMessageTemplates(auth.ctx.membership.orgId)
  return { ok: true, data: { templates, canManage } }
}

export type BillingSectionData = {
  tier: Tier
  status: string
  billingCycle: BillingCycle | null
  unitQuantity: number
  unitCount: number
  orgName: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  hasStripeCustomer: boolean
  canManageBilling: boolean
  paymentMethod: PaymentMethodSummary | null
  invoices: InvoiceSummary[]
}

export async function loadBillingSection(): Promise<SettingsLoadResult<BillingSectionData>> {
  const auth = await requireMemberContext()
  if (!auth.ok) return auth
  const { ctx, session } = auth
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'manager') {
    return { ok: false, redirectTo: '/agenda' }
  }

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
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

  return {
    ok: true,
    data: {
      tier: billing.tier,
      status: billing.status,
      billingCycle: billing.billingCycle,
      unitQuantity: billing.unitQuantity,
      unitCount: units.length,
      orgName: org?.name ?? null,
      currentPeriodEnd: billing.currentPeriodEnd,
      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
      hasStripeCustomer: billing.stripeCustomerId !== null,
      canManageBilling: hasMembershipCapability(ctx.membership, 'canManageBilling'),
      paymentMethod,
      invoices,
    },
  }
}
