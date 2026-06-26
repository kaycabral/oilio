// Functional core for the create-org form: pure parsing + validation of the
// submitted FormData into a typed payload (or a user-facing error string). No
// I/O — the createOrg saga (adapters) does the slug lookup + event emission.

import { VERTICALS, type Vertical } from '@/domain'
import { formString } from '@/shared/form-data'

export type OrgFormPayload = {
  name: string
  vertical: Vertical
}

export function parseOrgForm(formData: FormData): OrgFormPayload | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Name is too short'

  const vertical = formString(formData, 'vertical')
  if (!isVertical(vertical)) return 'Invalid vertical'

  return { name, vertical }
}

function isVertical(value: string): value is Vertical {
  return (VERTICALS as readonly string[]).includes(value)
}
