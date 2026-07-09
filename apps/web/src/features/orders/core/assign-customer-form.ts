import { formString } from '@/shared/form-data'

export type ParsedAssignCustomer =
  | { mode: 'existing'; customerId: string }
  | { mode: 'new'; newCustomer: { name: string; mobile: string } }
  | { mode: 'none' }

export function parseAssignCustomerForm(formData: FormData): ParsedAssignCustomer | string {
  const mode = formString(formData, 'customerMode') || 'existing'
  if (mode === 'none') return { mode: 'none' }
  if (mode === 'new') {
    const name = formString(formData, 'newCustomerName').trim()
    if (name.length < 2) return 'Nome do cliente é obrigatório'
    const mobile = formString(formData, 'newCustomerMobile').trim()
    if (mobile.length === 0) return 'WhatsApp do cliente é obrigatório'
    return { mode: 'new', newCustomer: { name, mobile } }
  }
  const customerId = formString(formData, 'customerId').trim()
  if (!customerId) return 'Cliente é obrigatório'
  return { mode: 'existing', customerId }
}
