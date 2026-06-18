import type { Org, Unit } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getActiveOrgContext, listAccessibleOrgs } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import type { OrgOption } from '@/shared/org/org-context'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { redirect } from 'next/navigation'
import 'server-only'

export type BusinessPageData = {
  // The active Negócio (folder) — expanded with its units below.
  org: Org
  // Units of the ACTIVE org only. Cross-org unit reads are forbidden by the
  // multi-org invariant; other Negócios expand once the user switches to them
  // (via the selector / the per-row "Abrir").
  units: Unit[]
  // Every Negócio the user is an active member of (id + name) — the folder list.
  // The active one is `org`; the rest render collapsed until switched into.
  orgs: OrgOption[]
  // Org-admin (owner/manager) — gates the create/edit affordances.
  canManage: boolean
}

// Imperative shell for the Negócios & Unidades surface (PRD Identidade v2, F5):
// the folder-manager that replaces the old "Empresa" page. Resolves the active
// Negócio + its Unidades, plus the list of all the user's Negócios for the
// folder view. Stays inside the multi-org invariant — only the active org's
// units are read here.
export async function loadBusinessPage(): Promise<BusinessPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const [units, orgs] = await Promise.all([
    listUnitsForOrg(ctx.membership.orgId),
    listAccessibleOrgs(session.uid),
  ])

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  return { org, units, orgs, canManage }
}
