import { isDispatchableType } from '@/domain'
import { formString } from '@/shared/form-data'

export type TemplateFormPayload = {
  type: string
  body: string
  enabled: boolean
}

export function parseTemplateForm(formData: FormData): TemplateFormPayload | string {
  const type = formString(formData, 'type')
  if (!isDispatchableType(type)) return 'Tipo de notificação inválido'

  const body = formString(formData, 'body').trim()
  if (body.length === 0) return 'A mensagem não pode ficar vazia'

  const enabled = formData.has('enabled')

  return { type, body, enabled }
}
