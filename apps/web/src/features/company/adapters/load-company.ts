import type { Org } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { redirect } from 'next/navigation'
import 'server-only'

export type CompanyPageData = {
  org: Org
  canManage: boolean
}

// Imperative shell for the company route: auth-gate + org fetch + role
// resolution. Redirects exhaust the unauthenticated/onboarding paths so the
// page renders against a resolved org.
export async function loadCompanyPage(): Promise<CompanyPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  return { org, canManage }
}
