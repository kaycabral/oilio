import { formString } from '@/shared/form-data'

// Parsed intent of the walk-in order's customer selector (brief 0081 / #1323).
// Three modes: `existing` (link a picked customer), `new` (register + link a
// customer inline), `none` (unlink — detach the current customer). `new` reuses
// the shared `resolveCustomerIdForWrite` upsert path in the action; `none` maps to
// a `customerId: null` assign event (link/unlink/swap are one nullable event).
export type ParsedAssignCustomer =
  | { mode: 'existing'; customerId: string }
  | { mode: 'new'; newCustomer: { name: string; whatsapp: string } }
  | { mode: 'none' }

export function parseAssignCustomerForm(formData: FormData): ParsedAssignCustomer | string {
  const mode = formString(formData, 'customerMode') || 'existing'
  if (mode === 'none') return { mode: 'none' }
  if (mode === 'new') {
    const name = formString(formData, 'newCustomerName').trim()
    if (name.length < 2) return 'Nome do cliente é obrigatório'
    const whatsapp = formString(formData, 'newCustomerWhatsapp').trim()
    if (whatsapp.length === 0) return 'WhatsApp do cliente é obrigatório'
    return { mode: 'new', newCustomer: { name, whatsapp } }
  }
  const customerId = formString(formData, 'customerId').trim()
  if (!customerId) return 'Cliente é obrigatório'
  return { mode: 'existing', customerId }
}
