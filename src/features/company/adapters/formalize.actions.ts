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

export async function formalizeUnit(formData: FormData): Promise<FormalizeResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const actorId = r.ctx.session.uid

  const unitId = formString(formData, 'unitId').trim()
  if (unitId.length === 0) return { ok: false, error: 'Unidade não informada' }

  const parsed = parseFormalizationFromForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const unit = await getUnitById(orgId, unitId)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }
  if (unit.fiscal.kind === 'company') {
    return { ok: false, error: 'Esta unidade já está formalizada.' }
  }

  const formalizedAt = new Date().toISOString()

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

  await writeUnitTaxIdentity(orgId, unitId, {
    kind: 'company',
    taxId: parsed.taxId,
    legalName: parsed.legalName,
    tradeName: parsed.tradeName,
  })

  revalidatePath('/company')
  return { ok: true }
}
