import { AppShell } from '@/components/app-shell'
import { getSessionUser } from '@/shared/auth/session'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { needsUnitSelection, resolveActiveUnit } from '@/shared/org/active-unit'
import { getOrgTier } from '@/shared/org/billing-read'
import { getActiveOrgContext, listAccessibleOrgs } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { OrgProvider } from '@/shared/org/org-context'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection()
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) {
    const linkedOrgIds = await listLinkedOrgIds(session.uid)
    if (linkedOrgIds.length > 0) redirect('/me/appointments')
    redirect('/onboarding')
  }

  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  if (await needsUnitSelection(ctx.membership)) redirect('/select-unit')

  const { units, activeUnitId } = await resolveActiveUnit(ctx.membership)

  const orgs = await listAccessibleOrgs(session.uid)
  const unitLocked = Boolean(ctx.membership.rlsUnitScope)

  const tier = await getOrgTier(ctx.membership.orgId)

  return (
    <OrgProvider
      value={{
        user: ctx.user,
        org,
        membership: ctx.membership,
        tier,
        orgs,
        units,
        activeUnitId,
        unitLocked,
      }}
    >
      <AppShell
        orgName={org.name}
        user={{
          name: ctx.user.displayName,
          secondary: ctx.user.email,
          avatarUrl: ctx.user.avatarUrl,
        }}
      >
        {children}
      </AppShell>
    </OrgProvider>
  )
}
