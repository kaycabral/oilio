// Pure professional-form parsing/validation, extracted from the `'use server'`
// actions (Functional Core / Imperative Shell) so it's importable + unit-tested.
// No I/O — the actions keep the Firestore writes + event emission. The
// service↔unit intersection invariant (#876) stays in the actions because it
// needs a Firestore read.

import { type CommissionRule, type TaxIdentity } from '@/domain'
import { formString } from '@/shared/form-data'
import { parseTaxIdentityFromForm } from '@/shared/org/tax-identity'

export type ProfessionalPayload = {
  taxIdentity: TaxIdentity | null
  defaultCommission: CommissionRule | null
  unitIds: string[]
  serviceIds: string[]
}

export function parseProfessionalForm(formData: FormData): ProfessionalPayload | string {
  const taxIdentity = parseTaxIdentityFromForm(formData)
  if (typeof taxIdentity === 'string') return taxIdentity

  const commissionKind = formString(formData, 'commissionKind')
  let defaultCommission: CommissionRule | null = null
  if (commissionKind === 'percentage' || commissionKind === 'fixed') {
    const raw = Number(formString(formData, 'commissionValue').replace(',', '.'))
    if (!Number.isFinite(raw) || raw < 0) return 'Valor de comissão inválido'
    defaultCommission = {
      kind: commissionKind,
      value: commissionKind === 'fixed' ? Math.round(raw * 100) : raw,
    }
  }

  const unitIds = Array.from(
    new Set(
      formData.getAll('unitIds').filter((u): u is string => typeof u === 'string' && u.length > 0),
    ),
  )
  if (unitIds.length === 0) {
    return 'Profissional precisa estar vinculado a pelo menos 1 unidade'
  }

  const serviceIds = Array.from(
    new Set(
      formData
        .getAll('serviceIds')
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    ),
  )

  return { taxIdentity, defaultCommission, unitIds, serviceIds }
}
