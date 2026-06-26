import { normalizeBrazilPhone } from '@/domain'
import { formString } from '@/shared/form-data'

// Parsed + validated wizard contact fields. `startAt` arrives pre-resolved
// as an ISO instant from the availability click (not a `datetime-local`),
// so parsing here is a plain `new Date()` plus a future-time guard.
export type WizardFields = {
  serviceId: string
  professionalId: string
  startAtDate: Date
  customerName: string
  whatsapp: string
  customerEmailRaw: string
}

// Pure parse of the confirm-step form. Returns the typed fields or a pt-BR
// error message. Reads only string-coercible form values — no I/O — so the
// validation rules are unit-tested without a server harness. `now` is
// injectable to keep the future-time guard deterministic in tests.
export function parseWizardFields(
  formData: FormData,
  now: number = Date.now(),
): WizardFields | string {
  const serviceId = formString(formData, 'serviceId').trim()
  const professionalId = formString(formData, 'professionalId').trim()
  const startAtIso = formString(formData, 'startAt').trim()
  const customerName = formString(formData, 'customerName').trim()
  const customerWhatsappRaw = formString(formData, 'customerWhatsapp').trim()
  const customerEmailRaw = formString(formData, 'customerEmail').trim()

  if (serviceId.length === 0) return 'Serviço não selecionado.'
  if (professionalId.length === 0) return 'Profissional não selecionado.'
  if (startAtIso.length === 0) return 'Horário não selecionado.'
  if (customerName.length < 2) return 'Informe seu nome completo.'
  const whatsapp = normalizeBrazilPhone(customerWhatsappRaw)
  if (!whatsapp) return 'Número de WhatsApp inválido.'

  const startAtDate = new Date(startAtIso)
  if (Number.isNaN(startAtDate.getTime())) return 'Horário inválido.'
  if (startAtDate.getTime() <= now) return 'Esse horário já passou.'

  return {
    serviceId,
    professionalId,
    startAtDate,
    customerName,
    whatsapp,
    customerEmailRaw,
  }
}
