import type { FirestoreDoc } from '@/domain/effect'
import { StoredInvite } from '@/domain/types/invite'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `invite` context (brief 0060, Grupo A) — plugged into
 * the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredInvite` schema
 * (the email-omitted shape — `email` lives in the deletable `invites_pii/{id}`
 * sidecar and merges at read time). It maps the scalars (role/status/tokenHash/
 * expiresAt/invitedBy/acceptedBy*) onto columns the DB constrains, including the
 * acceptance-consistency CHECK lifted from the domain refinement. The DB enforces
 * the invariants — a violation rolls back event + projection together.
 */

const decodeInvite = Schema.decodeUnknownSync(StoredInvite)

/** The ordered `invites` column list — single source of truth for the runtime
 * upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1. */
export const INVITE_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'version',
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
  aggregatePath: string,
  version: number,
): unknown[] {
  return [
    aggregatePath,
    invite.orgId,
    invite.id,
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
const CONFLICT_SET = INVITE_COLUMNS.filter((c) => c !== 'aggregate_path')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO invites (${INVITE_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (aggregate_path) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const invite = decodeInvite(state)
  await client.query(UPSERT, inviteColumnValues(invite, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type InviteRow = {
  org_id: string
  id: string
  version: string | number
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

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached. PII (`email`) is NOT present (merged from
// `invites_pii/` at read time).
export function rowToDoc(row: InviteRow): FirestoreDoc {
  return {
    _version: Number(row.version),
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

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<InviteRow>('SELECT * FROM invites WHERE aggregate_path = $1', [
    aggregatePath,
  ])
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM invites WHERE aggregate_path = $1', [aggregatePath])
}

export const inviteProjector: TypedProjector = { read, upsert, delete: remove }

export const INVITE_AGGREGATE_TYPE = 'invites'

registerTypedProjector(INVITE_AGGREGATE_TYPE, inviteProjector)
