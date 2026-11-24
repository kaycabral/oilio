import { operatesCrossUnit, type Org, type Unit } from '@/domain'
import { getSessionUser } from '@/shared/auth/session'
import {
  attachCanDelete,
  unitHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { getActiveOrgContext, listAccessibleOrgs } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import type { OrgOption } from '@/shared/org/org-context'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import 'server-only'

export type OrganizationsPageData = {
  org: Org
  units: WithCanDelete<Unit>[]
  orgs: OrgOption[]
  canManage: boolean
  canDelete: boolean
}

export async function loadOrganizationsPage(): Promise<OrganizationsPageData> {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  if (!operatesCrossUnit(ctx.membership)) redirect('/agenda')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const [storedUnits, orgs] = await Promise.all([
    listUnitsForOrg(ctx.membership.orgId),
    listAccessibleOrgs(session.uid),
  ])

  const units = await attachCanDelete(storedUnits, (id) =>
    unitHasActiveReference(ctx.membership.orgId, id),
  )

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const canDelete = ctx.membership.role === 'owner'
  return { org, units, orgs, canManage, canDelete }
}
