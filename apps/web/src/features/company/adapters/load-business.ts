import type { Org, Unit } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import {
  attachCanDelete,
  unitHasActiveReference,
  type WithCanDelete,
} from '@/shared/org/delete-guard'
import { getActiveOrgContext, listAccessibleOrgs } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import type { OrgOption } from '@/shared/org/org-context'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { redirect } from 'next/navigation'
import 'server-only'

export type BusinessPageData = {
  // The active Negócio (folder) — expanded with its units below.
  org: Org
  // Units of the ACTIVE org only, each with a precomputed `canDelete` flag
  // (brief 0033, AC-03): hard-delete is offered only when nothing actively
  // references the unit; otherwise the row offers Arquivar. Cross-org unit reads
  // are forbidden by the multi-org invariant; other Negócios expand once the
  // user switches to them (via the selector / the per-row "Abrir").
  units: WithCanDelete<Unit>[]
  // Every Negócio the user is an active member of (id + name) — the folder list.
  // The active one is `org`; the rest render collapsed until switched into.
  orgs: OrgOption[]
  // Org-admin (owner/manager) — gates the create/edit affordances.
  canManage: boolean
  // Owner-only — gates the destructive Excluir/Arquivar row action.
  canDelete: boolean
}

// Imperative shell for the Negócios & Unidades surface (PRD Identidade v2 —
// simplification): the SINGLE management surface that hosts both Negócio and
// Unidade CRUD (replaces the old "Empresa" page AND the separate "/units"
// listing). Resolves the active Negócio + its Unidades (with per-row delete
// flags), plus the list of all the user's Negócios for the folder view. Stays
// inside the multi-org invariant — only the active org's units are read here.
export async function loadBusinessPage(): Promise<BusinessPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const [storedUnits, orgs] = await Promise.all([
    listUnitsForOrg(ctx.membership.orgId),
    listAccessibleOrgs(session.uid),
  ])

  // Per-row reference-based flag (brief 0033, AC-03 — #1068 precompute): true
  // when no active professional / future appointment references the unit, so the
  // UI can offer Excluir; otherwise only Arquivar.
  const units = await attachCanDelete(storedUnits, (id) =>
    unitHasActiveReference(ctx.membership.orgId, id),
  )

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const canDelete = ctx.membership.role === 'owner'
  return { org, units, orgs, canManage, canDelete }
}
