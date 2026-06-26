import { AppShell } from '@/components/app-shell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { needsUnitSelection, resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext, listAccessibleOrgs } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { OrgProvider } from '@/shared/org/org-context'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  // #838 — every user must complete the post-OAuth profile step before any
  // app surface. Gate at the layout so client-side nav can't slip past.
  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  // No global onboarding gate (#986): the app is operable from signup. Setup
  // completeness is only required when publishing the public self-booking page
  // (#988), not to access internal routes.

  // First-access interstitial (brief 0029, AC-04): multi-unit member with no
  // chosen unit picks one before any operational surface renders. Single-unit
  // members (AC-05) and one-unit orgs enter directly — never redirected.
  if (await needsUnitSelection(ctx.membership)) redirect('/select-unit')

  // Shared active-unit context (brief 0029, AC-01/AC-02): accessible units +
  // the resolved active unit (cookie → validate → first accessible; a
  // single-unit member is pinned to membership.rlsUnitScope). Operational pages read
  // this via useOrg()/the cookie; the switcher (#1051) writes the cookie.
  const { units, activeUnitId } = await resolveActiveUnit(ctx.membership)

  // No first-unit gate (PRD Identidade v2 — simplification): a Negócio with no
  // Unidade is a normal empty state, NOT a forced onboarding screen. The owner
  // lands in the app normally and creates Unidades as an ordinary action from
  // /orgs. Onboarding ends after profile + create-Negócio.

  // Orgs the user can switch between (brief 0029, AC-09) — switcher shows the
  // org picker only when 2+. Single-unit members are locked (AC-05): the
  // switcher hides the unit picker and the interstitial never fires.
  const orgs = await listAccessibleOrgs(session.uid)
  // Treat a missing `rlsUnitScope` (legacy memberships predate the field) as
  // org-scoped — only a non-empty value pins the member (AC-05).
  const unitLocked = Boolean(ctx.membership.rlsUnitScope)

  return (
    <OrgProvider
      value={{
        user: ctx.user,
        org,
        membership: ctx.membership,
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
