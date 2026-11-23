import { type TaxIdentity, normalizeTaxId } from '@/domain'
import { formString } from '@/shared/form-data'
import { isValidCnpj, isValidCpf } from '@cbrl/br/tax-id'

export function parseTaxIdentityFromForm(formData: FormData): TaxIdentity | null | string {
  const taxKind = formString(formData, 'taxKind')
  if (taxKind !== 'individual' && taxKind !== 'company') return null
  const normalized = normalizeTaxId(formString(formData, 'taxId').trim())
  const legalName = formString(formData, 'legalName').trim()
  if (taxKind === 'individual') {
    if (!isValidCpf(normalized)) return 'CPF inválido'
    return { kind: 'individual', taxId: normalized }
  }
  if (!isValidCnpj(normalized)) return 'CNPJ inválido'
  if (legalName.length < 2) return 'Razão social obrigatória para empresa'
  return { kind: 'company', taxId: normalized, legalName }
}
