import type { AggregateRef, StoredDoc } from '@/domain/effect'
import { StoredInvite } from '@/domain/types/invite'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeInvite = Schema.decodeUnknownSync(StoredInvite)

export const INVITE_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'role',
  'token_hash',
  'expires_at',
  'status',
  'invited_by',
  'accepted_by_uid',
  'accepted_at',
  'created_at',
  'updated_at',
] as const

export function inviteColumnValues(
  invite: StoredInvite,
  ref: AggregateRef,
  version: number,
): unknown[] {
  return [
    ref.orgId,
    ref.id,
    version,
    invite.role,
    invite.tokenHash,
    invite.expiresAt,
    invite.status,
    invite.invitedBy,
    invite.acceptedByUid,
    invite.acceptedAt,
    invite.createdAt,
    invite.updatedAt,
  ]
}

const PLACEHOLDERS = INVITE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = INVITE_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO invites (${INVITE_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: StoredDoc): Promise<void> {
  const invite = decodeInvite(state)
  await client.query(UPSERT, inviteColumnValues(invite, ref, stateVersion(state)))
}

export type InviteRow = {
  org_id: string
  id: string
  last_event_version: string | number
  role: string
  token_hash: string
  expires_at: string
  status: string
  invited_by: string
  accepted_by_uid: string | null
  accepted_at: string | null
  created_at: string
  updated_at: string
}

export function rowToDoc(row: InviteRow): StoredDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    role: row.role,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at).toISOString(),
    status: row.status,
    invitedBy: row.invited_by,
    acceptedByUid: row.accepted_by_uid,
    acceptedAt: row.accepted_at == null ? null : new Date(row.accepted_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<InviteRow>('SELECT * FROM invites WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM invites WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const inviteProjector: TypedProjector = { read, upsert, delete: remove }

export const INVITE_AGGREGATE_TYPE = 'invite'

registerTypedProjector(INVITE_AGGREGATE_TYPE, inviteProjector)
