import { AppShell } from '@/components/app-shell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { needsUnitSelection, resolveActiveUnit } from '@/shared/tenant/active-unit'
import { getActiveTenantContext, listAccessibleTenants } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
import { TenantProvider } from '@/shared/tenant/tenant-context'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  // #838 — every user must complete the post-OAuth profile step before any
  // app surface. Gate at the layout so client-side nav can't slip past.
  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  const tenant = await getTenant(ctx.membership.tenantId)
  if (!tenant) redirect('/onboarding')

  // No global onboarding gate (#986): the app is operable from signup. Setup
  // completeness is only required when publishing the public self-booking page
  // (#988), not to access internal routes.

  // First-access interstitial (brief 0029, AC-04): multi-unit member with no
  // chosen unit picks one before any operational surface renders. Single-unit
  // members (AC-05) and one-unit tenants enter directly — never redirected.
  if (await needsUnitSelection(ctx.membership)) redirect('/select-unit')

  // Shared active-unit context (brief 0029, AC-01/AC-02): accessible units +
  // the resolved active unit (cookie → validate → first accessible; a
  // single-unit member is pinned to membership.unitId). Operational pages read
  // this via useTenant()/the cookie; the switcher (#1051) writes the cookie.
  const { units, activeUnitId } = await resolveActiveUnit(ctx.membership)

  // Tenants the user can switch between (brief 0029, AC-09) — switcher shows the
  // tenant picker only when 2+. Single-unit members are locked (AC-05): the
  // switcher hides the unit picker and the interstitial never fires.
  const tenants = await listAccessibleTenants(session.uid)
  // Treat a missing `unitId` (legacy memberships predate the field) as
  // tenant-scoped — only a non-empty value pins the member (AC-05).
  const unitLocked = Boolean(ctx.membership.unitId)

  return (
    <TenantProvider
      value={{
        user: ctx.user,
        tenant,
        membership: ctx.membership,
        tenants,
        units,
        activeUnitId,
        unitLocked,
      }}
    >
      <AppShell
        tenantName={tenant.name}
        user={{
          name: ctx.user.displayName,
          secondary: ctx.user.email,
          avatarUrl: ctx.user.avatarUrl,
        }}
      >
        {children}
      </AppShell>
    </TenantProvider>
  )
}
