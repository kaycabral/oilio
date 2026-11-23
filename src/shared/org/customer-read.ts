import {
  resolveSubjectAvatar,
  resolveSubjectName,
  StoredCustomer,
  type Customer,
  type User,
} from '@/domain'
import { rowToDoc, type CustomerRow } from '@/shared/db/pg/effect/customer-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getUsersByIds } from '@/shared/db/pg/users-store'
import { Schema } from 'effect'

const decodeStoredCustomer = Schema.decodeUnknownSync(StoredCustomer)

function isBlockedCustomer(c: StoredCustomer): boolean {
  return c.archivedAt !== null && c.archivedAt !== undefined
}

function emptyEnrichment(c: StoredCustomer): Customer {
  return {
    ...c,
    name: '(usuário não encontrado)',
    mobile: '',
    birthDate: null,
    avatarUrl: null,
    archivedAt: c.archivedAt ?? null,
    deactivatedAt: c.deactivatedAt ?? null,
  }
}

function mergeWithUser(c: StoredCustomer, u: User | undefined): Customer {
  if (!u) return emptyEnrichment(c)
  const blockedInOrg = isBlockedCustomer(c)
  const name = resolveSubjectName(c.userId, u, 'Cliente', { blockedInOrg }) ?? ''
  return {
    ...c,
    name,
    mobile: blockedInOrg ? '' : (u.mobile ?? ''),
    birthDate: blockedInOrg ? null : u.birthDate,
    avatarUrl: resolveSubjectAvatar(u, { blockedInOrg }),
    archivedAt: c.archivedAt ?? null,
    deactivatedAt: c.deactivatedAt ?? null,
  }
}

export async function enrichCustomers(
  _orgId: string,
  customers: readonly StoredCustomer[],
): Promise<Customer[]> {
  if (customers.length === 0) return []
  const users = await getUsersByIds(customers.map((c) => c.userId))
  return customers.map((c) => mergeWithUser(c, users.get(c.userId)))
}

export async function listCustomersForOrg(orgId: string): Promise<Customer[]> {
  const rows = await readUnderRls<CustomerRow>(orgId, (client) =>
    client
      .query<CustomerRow>('SELECT * FROM customers WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  const customers = rows.map((r) => decodeStoredCustomer(rowToDoc(r)))
  return enrichCustomers(orgId, customers)
}

export async function listActiveCustomersForOrg(orgId: string): Promise<Customer[]> {
  const all = await listCustomersForOrg(orgId)
  return all.filter((c) => c.archivedAt === null && c.deactivatedAt === null)
}

export async function getCustomerById(orgId: string, customerId: string): Promise<Customer | null> {
  const rows = await readUnderRls<CustomerRow>(orgId, (client) =>
    client
      .query<CustomerRow>('SELECT * FROM customers WHERE org_id = $1 AND id = $2', [
        orgId,
        customerId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichCustomers(orgId, [decodeStoredCustomer(rowToDoc(row))])
  return enriched ?? null
}

export async function getCustomerUserId(orgId: string, customerId: string): Promise<string | null> {
  const rows = await readUnderRls<{ user_id: string | null }>(orgId, (client) =>
    client
      .query<{
        user_id: string | null
      }>('SELECT user_id FROM customers WHERE org_id = $1 AND id = $2', [orgId, customerId])
      .then((res) => res.rows),
  )
  return rows[0]?.user_id ?? null
}
