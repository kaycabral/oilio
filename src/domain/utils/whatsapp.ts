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

export function renderWhatsappTemplate(template: string, vars: WhatsappTemplateVars): string {
  const lookup = new Map(Object.entries(vars))
  return template.replace(/\{(\w+)\}/g, (_, key: string) => lookup.get(key) ?? '')
}

export function resolveWhatsappTemplates(
  partial: Partial<WhatsappTemplates> | null | undefined,
): WhatsappTemplates {
  return {
    confirmation: partial?.confirmation?.trim() || DEFAULT_WHATSAPP_TEMPLATES.confirmation,
    reminder: partial?.reminder?.trim() || DEFAULT_WHATSAPP_TEMPLATES.reminder,
    cancellation: partial?.cancellation?.trim() || DEFAULT_WHATSAPP_TEMPLATES.cancellation,
  }
}
