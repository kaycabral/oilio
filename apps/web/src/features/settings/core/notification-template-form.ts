// Functional core for the notification-template edit form (brief 0018 / AC-13):
// pure parsing + validation of the submitted FormData into a typed payload (or a
// user-facing error string). No I/O — the adapter (notifications.actions) does
// the Firestore write.

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
