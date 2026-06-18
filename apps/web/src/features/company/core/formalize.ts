// Functional core for the Formalizar flow (brief 0048). Pure: parses + validates
// the submitted CNPJ lookup result into the data the action needs to emit
// `org.formalized`, run the ATIVA gate, and write the PII doc. No I/O — the
// adapter (`formalize.actions`) does the event emit + the matriz Unit update.

import {
  type CompanyProfile,
  CompanyProfile as CompanyProfileSchema,
  isActiveRegistrationStatus,
  isValidCompanyTaxId,
  normalizeTaxId,
} from '@/domain'
import { formString } from '@/shared/form-data'
import { Schema } from 'effect'

// The non-PII corporate part of the formalization (→ `org.formalized` event +
// `StoredOrg`) plus the PII name fields (→ deletable doc). Mirrors the shape the
// `/api/tax-id` lookup returns, split by LGPD class so the action routes each
// part to its home.
export type FormalizationInput = {
  taxId: string
  companyProfile: CompanyProfile
  legalName: string
  tradeName: string | null
}

const decodeCompanyProfile = Schema.decodeUnknownEither(CompanyProfileSchema)

// Parse the confirm submit. The client looked the CNPJ up via `/api/tax-id`
// (interceptable in e2e), reviewed it, and ships the result back as a serialized
// JSON hidden field (`profile`) plus `taxId` / `legalName` / `tradeName`. We
// re-validate everything server-side — never trust the client blindly:
//   - CNPJ shape (14 digits),
//   - the profile decodes to the domain `CompanyProfile`,
//   - the ATIVA gate (only an active registration status formalizes).
// Returns the typed input or a user-facing error string.
export function parseFormalizationFromForm(formData: FormData): FormalizationInput | string {
  const taxId = normalizeTaxId(formString(formData, 'taxId').trim())
  if (!isValidCompanyTaxId(taxId)) return 'CNPJ deve ter 14 dígitos'

  const profileRaw = formString(formData, 'profile').trim()
  if (profileRaw.length === 0) return 'Consulte o CNPJ antes de confirmar'

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(profileRaw)
  } catch {
    return 'Dados do CNPJ inválidos. Consulte novamente.'
  }

  const decoded = decodeCompanyProfile(parsedJson)
  if (decoded._tag === 'Left') return 'Dados do CNPJ inválidos. Consulte novamente.'
  const companyProfile = decoded.right

  // The matriz CNPJ-14 is the authoritative taxId — keep the looked-up profile
  // aligned to the submitted CNPJ so the event/Stored stay consistent.
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
