export const BRAZIL_MOBILE_E164_REGEX = /^55\d{2}9\d{8}$/

export function normalizeBrazilPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) return null
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if (digits.length === 12 || digits.length === 13) return digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

export function normalizeBrazilMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const e164 = digits.length === 11 ? `55${digits}` : digits
  return BRAZIL_MOBILE_E164_REGEX.test(e164) ? e164 : null
}

export function formatBrazilPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const local =
    (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
      ? digits.slice(2)
      : digits
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return raw
}

export function maskBrazilPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
