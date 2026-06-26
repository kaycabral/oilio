// Functional core for the customer form: pure parsing + validation of the
// submitted FormData into a typed payload (or a user-facing error string). No
// I/O — the adapter (customers.actions) does the upsert/PII write.

import { parseBirthDate } from '@/domain'

import { formString } from '@/shared/form-data'

export type CustomerFormPayload = {
  name: string
  whatsapp: string
  email: string | null
  birthDate: string | null
}

export function parseCustomerForm(formData: FormData): CustomerFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const whatsapp = formString(formData, 'whatsapp').trim()
  if (whatsapp.length === 0) return 'WhatsApp é obrigatório'
  const email = formString(formData, 'email').trim() || null

  const birthDateResult = parseBirthDate(formString(formData, 'birthDate'))
  if (!birthDateResult.ok) return birthDateResult.error

  return { name, whatsapp, email, birthDate: birthDateResult.value }
}
