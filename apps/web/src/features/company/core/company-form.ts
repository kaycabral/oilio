// Functional core for the company form: pure parsing + validation of submitted
// FormData field groups into typed partial updates (or a user-facing error
// string). No I/O — the adapter (company.actions) does the event emit + writes.

import { ORG_DESCRIPTION_MAX, type OrgBranding, isValidPublicHttpUrl } from '@/domain'
import { formString } from '@/shared/form-data'

// Each field group parses to its partial update, or an error message (string) —
// matching the `T | string` convention used by the form parsers in this app.
// Cancellation policy + confirmation message parsing moved out of the Org form
// (PRD Identidade v2 — those are appointment-agenda concerns of the Unit now).
export type BrandingUpdate = { branding: OrgBranding } | Record<string, never>

// Branding — só atualiza se ao menos um dos campos veio no submit. Empty string
// em URL = null (limpa); description vazia = null. URLs inválidas rejeitam com
// erro pra evitar persistir lixo silenciosamente.
export function parseBranding(formData: FormData): BrandingUpdate | string {
  const present =
    formData.has('brandingLogoUrl') ||
    formData.has('brandingBannerUrl') ||
    formData.has('brandingDescription')
  if (!present) return {}
  const logoRaw = formString(formData, 'brandingLogoUrl').trim()
  const bannerRaw = formString(formData, 'brandingBannerUrl').trim()
  const descRaw = formString(formData, 'brandingDescription').trim()
  if (logoRaw.length > 0 && !isValidPublicHttpUrl(logoRaw)) {
    return 'URL do logo inválida (precisa começar com http:// ou https://)'
  }
  if (bannerRaw.length > 0 && !isValidPublicHttpUrl(bannerRaw)) {
    return 'URL do banner inválida (precisa começar com http:// ou https://)'
  }
  if (descRaw.length > ORG_DESCRIPTION_MAX) {
    return `Descrição deve ter no máximo ${ORG_DESCRIPTION_MAX} caracteres`
  }
  return {
    branding: {
      logoUrl: logoRaw.length > 0 ? logoRaw : null,
      bannerUrl: bannerRaw.length > 0 ? bannerRaw : null,
      description: descRaw.length > 0 ? descRaw : null,
    },
  }
}
