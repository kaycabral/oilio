// Resolves the `customerUserId` / `professionalUserId` denormalized FKs we
// stamp on every Appointment write — the duplication that powers
// CollectionGroup history queries (#832, see Wiki § Visibilidade de histórico).
//
// Both fields are read straight from the source-of-truth (`Customer.userId`
// and `Professional.userId`) at write time. We never accept them from
// caller-supplied form data, so the data path can't drift out of sync.

import { readUnderRls } from '@/shared/db/pg/rls-read'
import 'server-only'

// Minimal id-ref probe rows — only the `user_id` FK each side denormalizes.
// `user_id` is null-distinguishable from "row absent" (empty result), so the
// resolver can tell "not found" from "found but missing userId".
type UserIdRow = { user_id: string | null }

async function readUserIdRow(
  orgId: string,
  collection: 'customers' | 'professionals',
  id: string,
): Promise<UserIdRow | undefined> {
  const rows = await readUnderRls<UserIdRow>(orgId, (client) =>
    client
      .query<UserIdRow>(`SELECT user_id FROM ${collection} WHERE aggregate_path = $1`, [
        `orgs/${orgId}/${collection}/${id}`,
      ])
      .then((res) => res.rows),
  )
  return rows[0]
}

export type ResolvedAppointmentUserIds = {
  customerUserId: string
  professionalUserId: string | null
}

type Resolution = { ok: true; ids: ResolvedAppointmentUserIds } | { ok: false; error: string }

export async function resolveAppointmentUserIds(
  orgId: string,
  customerId: string,
  professionalId: string,
): Promise<Resolution> {
  const [customerRow, professionalRow] = await Promise.all([
    readUserIdRow(orgId, 'customers', customerId),
    readUserIdRow(orgId, 'professionals', professionalId),
  ])

  if (!customerRow) return { ok: false, error: 'Cliente não encontrado' }
  if (!professionalRow) return { ok: false, error: 'Profissional não encontrado' }

  const customerUserId = customerRow.user_id
  if (!customerUserId) {
    // Defensive: every Customer is created via `upsertCustomerWithUser`
    // which guarantees a userId. Surface the inconsistency instead of
    // writing an Appointment with an empty key.
    return { ok: false, error: 'Customer sem userId — schema inconsistente' }
  }

  const professionalUserId = professionalRow.user_id ?? null

  return { ok: true, ids: { customerUserId, professionalUserId } }
}
