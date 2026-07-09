import { AgendaBlock } from '@/domain'
import { rowToDoc, type AgendaBlockRow } from '@/shared/db/pg/effect/agenda-block-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeAgendaBlock = Schema.decodeUnknownSync(AgendaBlock)

export async function listAgendaBlocksForUnit(
  orgId: string,
  unitId: string,
  memberOperationId = '',
): Promise<AgendaBlock[]> {
  const rows = await readUnderRls<AgendaBlockRow>(
    orgId,
    (client) =>
      client
        .query<AgendaBlockRow>('SELECT * FROM agenda_blocks WHERE org_id = $1 AND unit_id = $2', [
          orgId,
          unitId,
        ])
        .then((res) => res.rows),
    unitId,
    memberOperationId,
  )
  return rows.map((r) => decodeAgendaBlock(rowToDoc(r)))
}

export async function listAgendaBlocksByMemberOperationId(
  orgId: string,
  memberOperationId: string,
): Promise<AgendaBlock[]> {
  const rows = await readUnderRls<AgendaBlockRow>(orgId, (client) =>
    client
      .query<AgendaBlockRow>(
        'SELECT * FROM agenda_blocks WHERE org_id = $1 AND member_operation_id = $2',
        [orgId, memberOperationId],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeAgendaBlock(rowToDoc(r)))
}
