import { operatesCrossUnit, type Org, type TaxIdentity, type Unit } from '@/domain'
import { getSessionUser } from '@/shared/auth/session'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { getUnitById, getUnitTaxIdentity } from '@/shared/org/unit-read'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

export type UnitForEditData = {
  orgId: string
  unit: Unit
  org: Org | null
  unitTaxIdentity: TaxIdentity | null
  canFormalize: boolean
}

export async function loadUnitForEdit(unitId: string): Promise<UnitForEditData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!operatesCrossUnit(ctx.membership)) redirect('/agenda')

  const [unit, org, unitTaxIdentity] = await Promise.all([
    getUnitById(ctx.membership.orgId, unitId),
    getOrg(ctx.membership.orgId),
    getUnitTaxIdentity(ctx.membership.orgId, unitId),
  ])
  if (!unit) notFound()

  const canFormalize = ctx.membership.role === 'owner'
  return { orgId: ctx.membership.orgId, unit, org, unitTaxIdentity, canFormalize }
}
