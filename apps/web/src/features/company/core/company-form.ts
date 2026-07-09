import { ORG_DESCRIPTION_MAX, type OrgBranding, isValidPublicHttpUrl } from '@/domain'
import { formString } from '@/shared/form-data'

export type BrandingUpdate = { branding: OrgBranding } | Record<string, never>

export type WebsiteUpdate = { website: string | null } | Record<string, never>

export function parseWebsite(formData: FormData): WebsiteUpdate | string {
  if (!formData.has('website')) return {}
  const raw = formString(formData, 'website').trim()
  if (raw.length === 0) return { website: null }
  if (!isValidPublicHttpUrl(raw)) {
    return 'Site inválido (precisa começar com http:// ou https://)'
  }
  return { website: raw }
}

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
