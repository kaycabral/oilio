import { operatesCrossUnit, type Org, type TaxIdentity, type Unit } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { getUnitById, getUnitTaxIdentity } from '@/shared/org/unit-read'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

export type UnitForEditData = {
  orgId: string
  unit: Unit
  org: Org | null
  // Razão social / nome fantasia of the unit, from the deletable per-unit PII
  // doc (merged here at read time). `null` while informal or erased. Feeds the
  // read-only fiscal section (PRD Identidade v2 — fiscal lives on the unit).
  unitTaxIdentity: TaxIdentity | null
  // Formalization is owner-only (matches `formalizeUnit`): managers see the
  // read-only fiscal section but not the Formalizar CTA.
  canFormalize: boolean
}

// Imperative shell for the unit detail/edit route — resolves the unit (404 when
// missing) plus the org (for the public booking QR slug) and the unit's fiscal
// PII (for the fiscal section, PRD Identidade v2 — fiscal moved Org→Unit).
export async function loadUnitForEdit(unitId: string): Promise<UnitForEditData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  // Same cross-unit gate as `/units` (brief 0039 AC-05).
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
