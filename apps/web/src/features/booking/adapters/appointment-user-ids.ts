// Resolves the `customerUserId` / `memberOperatorUserId` denormalized FKs we
// stamp on every Appointment write — the duplication that powers
// CollectionGroup history queries (#832, see Wiki § Visibilidade de histórico).
//
// Both fields are read straight from the source-of-truth (`Customer.userId`
// and `MemberOperation.userId`) at write time. We never accept them from
// caller-supplied form data, so the data path can't drift out of sync.

import { readUnderRls } from '@/shared/db/pg/rls-read'
import 'server-only'

// Minimal id-ref probe rows — only the `user_id` FK each side denormalizes.
// `user_id` is null-distinguishable from "row absent" (empty result), so the
// resolver can tell "not found" from "found but missing userId".
type UserIdRow = { user_id: string | null }

async function readUserIdRow(
  orgId: string,
  collection: 'customers' | 'member_operations',
  id: string,
): Promise<UserIdRow | undefined> {
  const rows = await readUnderRls<UserIdRow>(orgId, (client) =>
    client
      .query<UserIdRow>(`SELECT user_id FROM ${collection} WHERE org_id = $1 AND id = $2`, [
        orgId,
        id,
      ])
      .then((res) => res.rows),
  )
  return rows[0]
}

export type ResolvedAppointmentUserIds = {
  customerUserId: string
  memberOperatorUserId: string | null
}

type Resolution = { ok: true; ids: ResolvedAppointmentUserIds } | { ok: false; error: string }

export async function resolveAppointmentUserIds(
  orgId: string,
  customerId: string,
  memberOperationId: string,
): Promise<Resolution> {
  const [customerRow, memberOperationRow] = await Promise.all([
    readUserIdRow(orgId, 'customers', customerId),
    readUserIdRow(orgId, 'member_operations', memberOperationId),
  ])

  if (!customerRow) return { ok: false, error: 'Cliente não encontrado' }
  if (!memberOperationRow) return { ok: false, error: 'Profissional não encontrado' }

  const customerUserId = customerRow.user_id
  if (!customerUserId) {
    // Defensive: every Customer is created via `upsertCustomerWithUser`
    // which guarantees a userId. Surface the inconsistency instead of
    // writing an Appointment with an empty key.
    return { ok: false, error: 'Customer sem userId — schema inconsistente' }
  }

  const memberOperatorUserId = memberOperationRow.user_id ?? null

  return { ok: true, ids: { customerUserId, memberOperatorUserId } }
}
