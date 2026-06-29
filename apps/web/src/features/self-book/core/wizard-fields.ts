import { formString } from '@/shared/form-data'

// Parsed + validated wizard booking fields. Since brief 0077 (#1275) the confirm
// step carries NO customer PII — login is required and the customer is derived
// from the authenticated uid — so only the booking coordinates are parsed here.
// `startAt` arrives pre-resolved as an ISO instant from the availability click
// (not a `datetime-local`), so parsing is a plain `new Date()` + a future guard.
export type WizardFields = {
  serviceId: string
  memberOperationId: string
  startAtDate: Date
}

// Pure parse of the confirm-step form. Returns the typed fields or a pt-BR error
// message. Reads only string-coercible form values — no I/O — so the validation
// rules are unit-tested without a server harness. `now` is injectable to keep the
// future-time guard deterministic in tests.
export function parseWizardFields(
  formData: FormData,
  now: number = Date.now(),
): WizardFields | string {
  const serviceId = formString(formData, 'serviceId').trim()
  const memberOperationId = formString(formData, 'memberOperationId').trim()
  const startAtIso = formString(formData, 'startAt').trim()

  if (serviceId.length === 0) return 'Serviço não selecionado.'
  if (memberOperationId.length === 0) return 'Profissional não selecionado.'
  if (startAtIso.length === 0) return 'Horário não selecionado.'

  const startAtDate = new Date(startAtIso)
  if (Number.isNaN(startAtDate.getTime())) return 'Horário inválido.'
  if (startAtDate.getTime() <= now) return 'Esse horário já passou.'

  return { serviceId, memberOperationId, startAtDate }
}
