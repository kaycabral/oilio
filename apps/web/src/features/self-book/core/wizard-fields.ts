import { formString } from '@/shared/form-data'

export type WizardFields = {
  serviceId: string
  memberOperationId: string
  startAtDate: Date
}

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
