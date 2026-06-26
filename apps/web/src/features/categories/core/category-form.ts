// Functional core for the category form: pure parsing + validation of the
// submitted FormData into a typed payload (or a user-facing error string). No
// I/O — the adapter (categories.actions) does the event emission.

import { CATEGORY_NAME_MAX, CATEGORY_NAME_MIN } from '@/domain'

import { formString } from '@/shared/form-data'

export type CategoryFormPayload = {
  name: string
  icon: string | null
  color: string | null
  active: boolean
}

export function parseCategoryForm(formData: FormData): CategoryFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < CATEGORY_NAME_MIN) return 'Nome é obrigatório'
  if (name.length > CATEGORY_NAME_MAX) return `Nome muito longo (máx. ${CATEGORY_NAME_MAX})`

  const icon = formString(formData, 'icon').trim() || null
  const color = formString(formData, 'color').trim() || null
  const active = formData.get('active') === 'on'

  return { name, icon, color, active }
}
