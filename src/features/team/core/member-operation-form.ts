import { type CommissionRule, type TaxIdentity } from '@/domain'
import { formCents, formString } from '@/shared/form-data'
import { parseTaxIdentityFromForm } from '@/shared/org/tax-identity'

export type MemberOperationPayload = {
  taxIdentity: TaxIdentity | null
  defaultCommission: CommissionRule | null
  unitIds: string[]
  catalogServiceIds: string[]
}

export function parseMemberOperationForm(formData: FormData): MemberOperationPayload | string {
  const taxIdentity = parseTaxIdentityFromForm(formData)
  if (typeof taxIdentity === 'string') return taxIdentity

  const commissionKind = formString(formData, 'commissionKind')
  let defaultCommission: CommissionRule | null = null
  if (commissionKind === 'percentage' || commissionKind === 'fixed') {
    if (commissionKind === 'fixed') {
      const cents = formCents(formData, 'commissionValue')
      if (cents === null) return 'Valor de comissão inválido'
      defaultCommission = { kind: commissionKind, value: cents }
    } else {
      const raw = Number(formString(formData, 'commissionValue').replace(',', '.'))
      if (!Number.isFinite(raw) || raw < 0) return 'Valor de comissão inválido'
      defaultCommission = { kind: commissionKind, value: raw }
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

  const catalogServiceIds = Array.from(
    new Set(
      formData
        .getAll('catalogServiceIds')
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    ),
  )

  return { taxIdentity, defaultCommission, unitIds, catalogServiceIds }
}
