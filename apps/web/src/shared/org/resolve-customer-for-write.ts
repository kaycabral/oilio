import 'server-only'

import type { Membership } from '@/domain'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { hasMembershipCapability } from '@/shared/org/membership'

// Resolves the customer id for a write that can attach a customer: either the
// picked existing one, or a brand-new customer upserted inline. Shared across the
// entry points that link a customer (appointment create — brief 0032/#1266; walk-in
// order — brief 0081/#1323), so "pick existing OR register new" stays ONE path and
// can't drift between surfaces. The inline branch is gated server-side on
// `canManageCustomers`: registering a customer is a front-desk action, so the UI
// hides the toggle for a self-scoped member AND this refuses the POST too (UI-only
// authorization is no authorization). Returns the resolved id, or the action error
// to early-return. The customer projection event is emitted by the upsert layer.
export async function resolveCustomerIdForWrite(
  membership: Membership,
  parsed: { customerId: string | null; newCustomer: { name: string; whatsapp: string } | null },
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  if (parsed.newCustomer) {
    if (!hasMembershipCapability(membership, 'canManageCustomers')) {
      return { ok: false, error: 'Você não tem permissão para cadastrar novos clientes' }
    }
    const upsert = await upsertCustomerWithUser({
      orgId: membership.orgId,
      name: parsed.newCustomer.name,
      whatsappRaw: parsed.newCustomer.whatsapp,
      email: null,
      birthDate: null,
    })
    if (!upsert.ok) return upsert
    return { ok: true, customerId: upsert.customerId }
  }
  if (!parsed.customerId) return { ok: false, error: 'Cliente não resolvido' }
  return { ok: true, customerId: parsed.customerId }
}
