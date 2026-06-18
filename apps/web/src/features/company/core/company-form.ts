// Functional core for the company form: pure parsing + validation of submitted
// FormData field groups into typed partial updates (or a user-facing error
// string). No I/O — the adapter (company.actions) does the event emit + writes.

import {
  type CancellationPolicy,
  DEFAULT_CANCELLATION_POLICY,
  MAX_CANCELLATION_NOTICE_MINUTES,
  MIN_CANCELLATION_NOTICE_MINUTES,
  ORG_DESCRIPTION_MAX,
  type OrgBranding,
  isValidCancellationNoticeMinutes,
  isValidPublicHttpUrl,
  resolveWhatsappTemplates,
} from '@/domain'
import { formString } from '@/shared/form-data'

// Each field group parses to its partial update, or an error message (string) —
// matching the `T | string` convention used by the form parsers in this app.
export type CancellationUpdate = { cancellationPolicy: CancellationPolicy } | Record<string, never>
export type BrandingUpdate = { branding: OrgBranding } | Record<string, never>
export type WhatsappUpdate =
  | { whatsappTemplates: ReturnType<typeof resolveWhatsappTemplates> }
  | Record<string, never>

// Cancellation policy: toggle is an HTML checkbox (key present when on, absent
// when off). The minutes input ships as a hidden field even when disabled so
// the value survives a disable → re-enable round-trip.
export function parseCancellationPolicy(formData: FormData): CancellationUpdate | string {
  if (!formData.has('cancellationPolicyMinNoticeMinutes')) return {}
  const enabled = formData.has('cancellationPolicyEnabled')
  const minutesRaw = Number(formData.get('cancellationPolicyMinNoticeMinutes'))
  const valid = isValidCancellationNoticeMinutes(minutesRaw)
  if (enabled && !valid) {
    return `Política de cancelamento: informe um inteiro entre ${MIN_CANCELLATION_NOTICE_MINUTES} e ${MAX_CANCELLATION_NOTICE_MINUTES} minutos`
  }
  const minutes = valid ? minutesRaw : DEFAULT_CANCELLATION_POLICY.minNoticeMinutes
  return { cancellationPolicy: { enabled, minNoticeMinutes: minutes } }
}

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

// Resolve through the same fallback path used at read time — empty input
// restores the default rather than persisting "".
export function parseWhatsappTemplates(formData: FormData): WhatsappUpdate {
  if (!formData.has('whatsappConfirmation')) return {}
  const confirmation = formString(formData, 'whatsappConfirmation')
  return { whatsappTemplates: resolveWhatsappTemplates({ confirmation }) }
}
