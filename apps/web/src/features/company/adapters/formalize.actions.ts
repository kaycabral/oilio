'use server'

import { UnitConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { parseFormalizationFromForm } from '@/features/company/core/formalize'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireOwnerCtx } from '@/shared/org/membership'
import { getUnitById, writeUnitTaxIdentity } from '@/shared/org/unit-read'
import { revalidatePath } from 'next/cache'

export type FormalizeResult = { ok: true } | { ok: false; error: string }

// Formalize an informal Unit into a `company` (brief 0048 / PRD Identidade v2).
// Owner-only. The fiscal identity belongs to the establishment (the Unit), not
// the Org folder, so this targets a UNIT. The client already looked the CNPJ up
// via `/api/tax-id` and reviewed it; this action re-validates, enforces the
// ATIVA gate (in the core parser), and runs the saga:
//   1. emit `unit.formalized` — the Unit gains the CNPJ-14 + CompanyProfile +
//      formalizedAt; the reducer flips `Unit.fiscal` to `{ kind: 'company' }`;
//   2. write razão social / nome fantasia to the deletable per-unit PII doc
//      (`orgs/{orgId}/units/{unitId}/private/taxIdentity`) — NEVER into the
//      event (ADR 0010).
// Matriz/filial/raiz are DERIVED from the CNPJ-14 on read, never stored.
// Idempotent/guarded: an already-`company` Unit is rejected before any write.
export async function formalizeUnit(formData: FormData): Promise<FormalizeResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const actorId = r.ctx.session.uid

  const unitId = formString(formData, 'unitId').trim()
  if (unitId.length === 0) return { ok: false, error: 'Unidade não informada' }

  const parsed = parseFormalizationFromForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Guard: can't re-formalize. Read the current projection (single source of the
  // fiscal stage) before emitting. The read is org-scoped (multi-org invariant).
  const unit = await getUnitById(orgId, unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }
  if (unit.fiscal.kind === 'company') {
    return { ok: false, error: 'Esta unidade já está formalizada.' }
  }

  const formalizedAt = new Date().toISOString()

  // Step 1: unit.formalized (non-PII corporate data only).
  const formalized = await emitEvent(UnitConfig, aggregateRef(UnitConfig, orgId, unitId), {
    _tag: 'unit.formalized',
    actorId,
    payload: {
      taxId: parsed.taxId,
      companyProfile: parsed.companyProfile,
      formalizedAt,
    },
  })
  if (!formalized.ok) return { ok: false, error: formalized.error }

  // Step 2: razão social / nome fantasia → deletable per-unit PII doc
  // (LGPD, ADR 0010).
  await writeUnitTaxIdentity(orgId, unitId, {
    kind: 'company',
    taxId: parsed.taxId,
    legalName: parsed.legalName,
    tradeName: parsed.tradeName,
  })

  revalidatePath('/company')
  return { ok: true }
}
