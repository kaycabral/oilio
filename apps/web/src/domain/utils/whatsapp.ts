// WhatsApp CHANNEL helpers. We use wa.me links (no API) — the browser opens
// the user's WhatsApp with the message pre-filled; the operator hits send.
// This module is about the *channel* (message templates + deep-link); the
// phone-number utilities (normalize/mask/format) live in `./phone`.

import { normalizeBrazilPhone } from './phone'

// Default templates per template kind. Orgs can override via the /company
// page; if a org's stored template is empty/missing, these defaults render.
export const DEFAULT_WHATSAPP_TEMPLATES = {
  confirmation:
    'Olá {customerName}! Confirmando seu agendamento em {businessName}: {serviceName} com {memberOperationName} em {date} às {time}. Qualquer dúvida, é só responder por aqui.',
  reminder:
    'Oi {customerName}! Lembrete do seu agendamento amanhã ({date}) às {time} — {serviceName} com {memberOperationName} em {businessName}. Até lá!',
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
  memberOperationName?: string
  date?: string
  time?: string
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

// Fills missing template fields with defaults — used when reading a org doc
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
