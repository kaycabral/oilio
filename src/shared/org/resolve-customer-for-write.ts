import 'server-only'

import type { Membership } from '@/domain'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { hasMembershipCapability } from '@/shared/org/membership'

export async function resolveCustomerIdForWrite(
  membership: Membership,
  parsed: { customerId: string | null; newCustomer: { name: string; mobile: string } | null },
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  if (parsed.newCustomer) {
    if (!hasMembershipCapability(membership, 'canManageCustomers')) {
      return { ok: false, error: 'Você não tem permissão para cadastrar novos clientes' }
    }
    const upsert = await upsertCustomerWithUser({
      orgId: membership.orgId,
      name: parsed.newCustomer.name,
      mobileRaw: parsed.newCustomer.mobile,
      email: null,
      birthDate: null,
    })
    if (!upsert.ok) return upsert
    return { ok: true, customerId: upsert.customerId }
  }
  if (!parsed.customerId) return { ok: false, error: 'Cliente não resolvido' }
  return { ok: true, customerId: parsed.customerId }
}
