import type { Tenant } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
import { redirect } from 'next/navigation'
import 'server-only'

export type CompanyPageData = {
  tenant: Tenant
  canManage: boolean
}

// Imperative shell for the company route: auth-gate + tenant fetch + role
// resolution. Redirects exhaust the unauthenticated/onboarding paths so the
// page renders against a resolved tenant.
export async function loadCompanyPage(): Promise<CompanyPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const tenant = await getTenant(ctx.membership.tenantId)
  if (!tenant) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  return { tenant, canManage }
}
