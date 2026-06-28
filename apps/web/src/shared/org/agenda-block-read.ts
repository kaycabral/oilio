// Reads for the `agenda-block` context (brief 0060, Grupo C). Reads the typed
// `agenda_blocks` table under RLS (unit-scoped GUC). Agenda blocks carry no PII,
// so there is no sidecar merge.

import { AgendaBlock } from '@/domain'
import { rowToDoc, type AgendaBlockRow } from '@/shared/db/pg/effect/agenda-block-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeAgendaBlock = Schema.decodeUnknownSync(AgendaBlock)

// All agenda blocks for a unit, filtered by `(org_id, unit_id)` under RLS
// (passing `unitId` sets `app.current_unit` for the unit-scoped policy).
// Own-scope (brief 0075, #1256): a memberOperation's id narrows the read to their
// own blocks PLUS unit-wide blocks (NULL member_operation_id) via the
// `app.current_member_operation` predicate; `''` (the balcão) reads all.
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

// All agenda blocks scoped to a memberOperation (`memberOperationId` column). Filters
// `WHERE org_id AND member_operation_id` under RLS (no `unitId` pin — a memberOperation's
// blocks may span units, so the query is org-wide and the unit GUC is left empty).
// Used by the offboarding cascade (clean a leaving memberOperation's blocks) and the
// member-detail edit context.
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
