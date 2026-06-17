// WhatsApp deep link helpers. We use wa.me links (no API) — the browser opens
// the user's WhatsApp with the message pre-filled; the operator hits send.

// Default templates per template kind. Tenants can override via the /company
// page; if a tenant's stored template is empty/missing, these defaults render.
export const DEFAULT_WHATSAPP_TEMPLATES = {
  confirmation:
    'Olá {customerName}! Confirmando seu agendamento em {businessName}: {serviceName} com {professionalName} em {date} às {time}. Qualquer dúvida, é só responder por aqui.',
  reminder:
    'Oi {customerName}! Lembrete do seu agendamento amanhã ({date}) às {time} — {serviceName} com {professionalName} em {businessName}. Até lá!',
  cancellation:
    'Olá {customerName}, infelizmente precisamos cancelar seu agendamento de {serviceName} em {date} às {time}. Vamos remarcar?',
} as const

export type WhatsappTemplateKind = keyof typeof DEFAULT_WHATSAPP_TEMPLATES

export type WhatsappTemplates = {
  confirmation: string
  reminder: string
  cancellation: string
}

export type WhatsappTemplateVars = {
  customerName?: string
  businessName?: string
  serviceName?: string
  professionalName?: string
  date?: string
  time?: string
}

// Normalize a Brazilian phone number to E.164 digits (no `+`).
// - Strips non-digits.
// - Prepends `55` if absent and the number looks domestic (10 or 11 digits).
// - Returns null when length doesn't match a plausible BR mobile (12 or 13).
// Notes:
//   - We deliberately don't validate area code (DDD). Garbage in → user fixes.
//   - International numbers already prefixed with country code != 55 are
//     accepted as long as total length is 11–15 digits (ITU E.164 max 15).
export function normalizeBrazilPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) return null
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if (digits.length === 12 || digits.length === 13) return digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
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

// Replace `{key}` placeholders with the matching var; missing/empty values
// become an empty string so the message reads naturally instead of "{undefined}".
export function renderWhatsappTemplate(template: string, vars: WhatsappTemplateVars): string {
  const lookup = new Map(Object.entries(vars))
  return template.replace(/\{(\w+)\}/g, (_, key: string) => lookup.get(key) ?? '')
}

// Returns null when the phone can't be normalized — caller should hide the
// "Send WhatsApp" affordance instead of generating a broken link.
export function buildWhatsappLink(rawPhone: string, message: string): string | null {
  const phone = normalizeBrazilPhone(rawPhone)
  if (!phone) return null
  const text = encodeURIComponent(message)
  return `https://wa.me/${phone}?text=${text}`
}

// Fills missing template fields with defaults — used when reading a tenant doc
// that pre-dates the templates field, or when an operator wipes one to "".
export function resolveWhatsappTemplates(
  partial: Partial<WhatsappTemplates> | null | undefined,
): WhatsappTemplates {
  return {
    confirmation: partial?.confirmation?.trim() || DEFAULT_WHATSAPP_TEMPLATES.confirmation,
    reminder: partial?.reminder?.trim() || DEFAULT_WHATSAPP_TEMPLATES.reminder,
    cancellation: partial?.cancellation?.trim() || DEFAULT_WHATSAPP_TEMPLATES.cancellation,
  }
}
