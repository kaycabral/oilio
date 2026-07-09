import {
  type TaxIdentity,
  isValidCompanyTaxId,
  isValidIndividualTaxId,
  normalizeTaxId,
} from '@/domain'
import { formString } from '@/shared/form-data'

export function parseTaxIdentityFromForm(formData: FormData): TaxIdentity | null | string {
  const taxKind = formString(formData, 'taxKind')
  if (taxKind !== 'individual' && taxKind !== 'company') return null
  const normalized = normalizeTaxId(formString(formData, 'taxId').trim())
  const legalName = formString(formData, 'legalName').trim()
  if (taxKind === 'individual') {
    if (!isValidIndividualTaxId(normalized)) return 'CPF deve ter 11 dígitos'
    return { kind: 'individual', taxId: normalized }
  }
  if (!isValidCompanyTaxId(normalized)) return 'CNPJ deve ter 14 dígitos'
  if (legalName.length < 2) return 'Razão social obrigatória para empresa'
  return { kind: 'company', taxId: normalized, legalName }
}
