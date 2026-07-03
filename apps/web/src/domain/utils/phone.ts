// Brazilian phone-number helpers — normalization, strict-mobile validation,
// display formatting and progressive input masking. These are neutral phone
// utilities (NOT WhatsApp-specific): they back the `mobile` field of a person
// (user/customer/professional/invitee) and the contact number of a unit. The
// WhatsApp *channel* helpers (templates, wa.me link) live in `./whatsapp`.

// Strict Brazilian MOBILE in E.164 digits (no `+`): country 55 + 2-digit DDD +
// the mandatory leading `9` + 8 subscriber digits. Post-2016 every BR mobile
// carries the 9th digit, so a valid mobile is exactly 11 domestic digits
// (13 with the country code). This is the wall that rejects an 8/10-digit
// number typed where a real mobile is required (invite/profile/quick-add).
export const BRAZIL_MOBILE_E164_REGEX = /^55\d{2}9\d{8}$/

// Normalize a Brazilian phone number to E.164 digits (no `+`).
// - Strips non-digits.
// - Prepends `55` if absent and the number looks domestic (10 or 11 digits).
// - Returns null when length doesn't match a plausible BR phone (12 or 13).
// Notes:
//   - We deliberately don't validate area code (DDD). Garbage in → user fixes.
//   - International numbers already prefixed with country code != 55 are
//     accepted as long as total length is 11–15 digits (ITU E.164 max 15).
//   - Accepts landline (10 domestic digits) — use `normalizeBrazilMobile` for
//     flows that must reject a non-mobile number.
export function normalizeBrazilPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) return null
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if (digits.length === 12 || digits.length === 13) return digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

// Normalize to a STRICT Brazilian mobile in E.164 digits, or null. Unlike
// `normalizeBrazilPhone` (which accepts a 10-digit landline), this rejects
// anything that isn't a real BR mobile: it requires the 9th digit and exactly
// 11 domestic digits (DDD + 9 + 8). Prepends `55` when the domestic form is
// given. Use for every flow that collects a PERSON's mobile — member/client
// invite, profile (onboarding + settings), front-desk quick-add.
export function normalizeBrazilMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const e164 = digits.length === 11 ? `55${digits}` : digits
  return BRAZIL_MOBILE_E164_REGEX.test(e164) ? e164 : null
}

// Format a stored phone for DISPLAY as a Brazilian number:
// "(11) 97000-0002" (mobile) / "(11) 3333-4444" (landline). Strips a leading
// `55` country code for domestic 12/13-digit numbers. Returns the input
// unchanged when it can't be confidently formatted (foreign / malformed).
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

// Progressive input mask for a Brazilian phone as the user types. Digits only,
// capped at 11 (DDD + 9-digit mobile); formats partials so the field reads
// naturally. The stored value is normalized server-side, so submitting the
// masked string is fine.
export function maskBrazilPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
