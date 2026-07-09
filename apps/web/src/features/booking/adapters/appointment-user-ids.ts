import { readUnderRls } from '@/shared/db/pg/rls-read'
import 'server-only'

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
    return { ok: false, error: 'Customer sem userId — schema inconsistente' }
  }

  const memberOperatorUserId = memberOperationRow.user_id ?? null

  return { ok: true, ids: { customerUserId, memberOperatorUserId } }
}
