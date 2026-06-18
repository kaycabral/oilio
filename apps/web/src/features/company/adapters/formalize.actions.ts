'use server'

import { StoredUnit } from '@/domain'
import { OrgConfig, UnitConfig } from '@/domain/aggregates'
import { parseFormalizationFromForm } from '@/features/company/core/formalize'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { requireOwnerCtx } from '@/shared/org/membership'
import { getOrg, writeOrgTaxIdentity } from '@/shared/org/org'
import { revalidatePath } from 'next/cache'

export type FormalizeResult = { ok: true } | { ok: false; error: string }

// Formalize an informal Org into a `company` (brief 0048). Owner-only. The
// client already looked the CNPJ up via `/api/tax-id` and reviewed it; this
// action re-validates, enforces the ATIVA gate (in the core parser), and runs
// the saga:
//   1. emit `org.formalized` — the Org gains the CNPJ-14 + CompanyProfile +
//      formalizedAt; the reducer flips fiscalProfile to `company`;
//   2. write razão social / nome fantasia to the deletable PII doc
//      (`orgs/{id}/private/taxIdentity`) — NEVER into the event (ADR 0010);
//   3. set the matriz Unit's CNPJ-14 (the informal matriz becomes matriz 0001).
// Idempotent/guarded: an already-`company` Org is rejected before any write.
export async function formalizeOrg(formData: FormData): Promise<FormalizeResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const actorId = r.ctx.session.uid

  const parsed = parseFormalizationFromForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Guard: can't re-formalize. Read the current projection (single source of the
  // stage) before emitting.
  const org = await getOrg(orgId)
  if (!org) return { ok: false, error: 'Empresa não encontrada' }
  if (org.fiscalProfile.stage === 'company') {
    return { ok: false, error: 'Esta empresa já está formalizada.' }
  }

  const db = getAdminFirestore()
  // The matriz is the oldest active unit (the auto-created establishment from
  // signup). Resolve it before emitting so we never formalize an Org without a
  // matriz to carry the CNPJ-14 (brief 0048 structural invariant).
  const matriz = await resolveMatrizUnit(db, orgId)
  if (!matriz) return { ok: false, error: 'Unidade matriz não encontrada' }

  const formalizedAt = new Date().toISOString()

  // Step 1: org.formalized (non-PII corporate data only).
  const formalized = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.formalized',
    actorId,
    payload: {
      taxId: parsed.taxId,
      companyProfile: parsed.companyProfile,
      formalizedAt,
    },
  })
  if (!formalized.ok) return { ok: false, error: formalized.error }

  // Step 2: razão social / nome fantasia → deletable PII doc (LGPD, ADR 0010).
  await writeOrgTaxIdentity(orgId, {
    kind: 'company',
    taxId: parsed.taxId,
    legalName: parsed.legalName,
    tradeName: parsed.tradeName,
  })

  // Step 3: the informal matriz becomes the matriz 0001 — gains the CNPJ-14.
  // Event-first (`unit.updated`); the reducer projects `taxId` onto the unit.
  const unitUpdated = await emitEvent(UnitConfig, `orgs/${orgId}/units/${matriz.id}`, {
    _tag: 'unit.updated',
    actorId,
    payload: { changes: { taxId: parsed.taxId } },
  })
  if (!unitUpdated.ok) return { ok: false, error: unitUpdated.error }

  revalidatePath('/company')
  return { ok: true }
}

// Resolve the matriz: the oldest active (non-archived) unit of the org. Informal
// orgs have exactly the one auto-created matriz; the oldest-active rule keeps it
// deterministic even if filiais exist later.
async function resolveMatrizUnit(
  db: ReturnType<typeof getAdminFirestore>,
  orgId: string,
): Promise<StoredUnit | null> {
  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('units')
    .withConverter(fsConverter(StoredUnit))
    .get()
  const active = snap.docs
    .map((d) => d.data())
    .filter((u) => u.archivedAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return active[0] ?? null
}
