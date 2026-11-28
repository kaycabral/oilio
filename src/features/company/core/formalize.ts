import {
  type CompanyProfile,
  CompanyProfile as CompanyProfileSchema,
  isActiveRegistrationStatus,
  normalizeTaxId,
} from '@/domain'
import { formString } from '@/shared/form-data'
import { isValidCnpj } from '@cbrl/br/tax-id'
import { Schema } from 'effect'

export type FormalizationInput = {
  taxId: string
  companyProfile: CompanyProfile
  legalName: string
  tradeName: string | null
}

const decodeCompanyProfile = Schema.decodeUnknownResult(CompanyProfileSchema)

export function parseFormalizationFromForm(formData: FormData): FormalizationInput | string {
  const taxId = normalizeTaxId(formString(formData, 'taxId').trim())
  if (!isValidCnpj(taxId)) return 'CNPJ inválido'

  const profileRaw = formString(formData, 'profile').trim()
  if (profileRaw.length === 0) return 'Consulte o CNPJ antes de confirmar'

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(profileRaw)
  } catch {
    return 'Dados do CNPJ inválidos. Consulte novamente.'
  }

  const decoded = decodeCompanyProfile(parsedJson)
  if (decoded._tag === 'Failure') return 'Dados do CNPJ inválidos. Consulte novamente.'
  const companyProfile = decoded.success

  if (normalizeTaxId(companyProfile.taxId) !== taxId) {
    return 'Dados do CNPJ inválidos. Consulte novamente.'
  }

  if (!isActiveRegistrationStatus(companyProfile.registrationStatus)) {
    return 'Só é possível formalizar um CNPJ com situação cadastral ATIVA na Receita.'
  }

  const legalName = formString(formData, 'legalName').trim()
  if (legalName.length < 2) return 'Razão social não informada pela consulta. Tente novamente.'
  const tradeNameRaw = formString(formData, 'tradeName').trim()

  return {
    taxId,
    companyProfile: { ...companyProfile, taxId },
    legalName,
    tradeName: tradeNameRaw.length > 0 ? tradeNameRaw : null,
  }
}
