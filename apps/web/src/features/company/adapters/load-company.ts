import type { Org, TaxIdentity, Unit } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { getUnitById, getUnitTaxIdentity } from '@/shared/org/unit-read'
import { redirect } from 'next/navigation'
import 'server-only'

export type CompanyPageData = {
  org: Org
  // The active unit carries the fiscal identity (PRD Identidade v2). `null` when
  // the org has no unit yet (the "Negócio sem unidade" empty state) — the page
  // then shows no fiscal block.
  activeUnit: Unit | null
  // Razão social / nome fantasia of the active unit, from the deletable per-unit
  // PII doc (merged here at read time). `null` while informal or erased.
  unitTaxIdentity: TaxIdentity | null
  canManage: boolean
  // Formalization is owner-only (matches `formalizeUnit`); managers see the
  // read-only fiscal section but not the CTA.
  canFormalize: boolean
}

// Imperative shell for the company route: auth-gate + org fetch + active-unit
// resolution + role resolution. Redirects exhaust the unauthenticated/
// onboarding paths so the page renders against a resolved org.
export async function loadCompanyPage(): Promise<CompanyPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  // The fiscal identity lives on the active unit (the establishment). Resolve it
  // org-scoped (multi-org invariant); enrich with PII (fiscal section reads the
  // razão social from the per-unit PII doc) via `getUnitById`.
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)
  const [activeUnit, unitTaxIdentity] = activeUnitId
    ? await Promise.all([
        getUnitById(ctx.membership.orgId, activeUnitId),
        getUnitTaxIdentity(ctx.membership.orgId, activeUnitId),
      ])
    : [null, null]

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const canFormalize = ctx.membership.role === 'owner'
  return { org, activeUnit, unitTaxIdentity, canManage, canFormalize }
}
