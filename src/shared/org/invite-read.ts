import { StoredInvite, type Invite, type InvitePii } from '@/domain'
import { rowToDoc, type InviteRow } from '@/shared/db/pg/effect/invite-projector'
import {
  deleteInvitePii as deleteInvitePiiRow,
  getInvitePiiByIds,
  upsertInvitePii,
} from '@/shared/db/pg/pii-sidecars-store'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

export type { InvitePii, StoredInvite } from '@/domain'

const decodeStoredInvite = Schema.decodeUnknownSync(StoredInvite)

function mergeWithPii(i: StoredInvite, pii: InvitePii | undefined): Invite {
  return { ...i, mobile: pii?.mobile ?? '' }
}

async function fetchPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, InvitePii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  return getInvitePiiByIds(orgId, unique)
}

export async function enrichInvites(
  orgId: string,
  invites: readonly StoredInvite[],
): Promise<Invite[]> {
  if (invites.length === 0) return []
  const pii = await fetchPiiByIds(
    orgId,
    invites.map((i) => i.id),
  )
  return invites.map((i) => mergeWithPii(i, pii.get(i.id)))
}

export async function listInvitesForOrg(orgId: string): Promise<Invite[]> {
  const rows = await readUnderRls<InviteRow>(orgId, (client) =>
    client
      .query<InviteRow>('SELECT * FROM invites WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredInvite(rowToDoc(r)))
  return enrichInvites(orgId, stored)
}

export async function getInviteById(orgId: string, inviteId: string): Promise<Invite | null> {
  const rows = await readUnderRls<InviteRow>(orgId, (client) =>
    client
      .query<InviteRow>('SELECT * FROM invites WHERE org_id = $1 AND id = $2', [orgId, inviteId])
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichInvites(orgId, [decodeStoredInvite(rowToDoc(row))])
  return enriched ?? null
}

export async function listInvitesByStatus(
  orgId: string,
  status: StoredInvite['status'],
): Promise<Invite[]> {
  const rows = await readUnderRls<InviteRow>(orgId, (client) =>
    client
      .query<InviteRow>('SELECT * FROM invites WHERE org_id = $1 AND status = $2', [orgId, status])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredInvite(rowToDoc(r)))
  return enrichInvites(orgId, stored)
}

export async function writeInvitePii(
  orgId: string,
  inviteId: string,
  pii: InvitePii,
): Promise<void> {
  await upsertInvitePii({ orgId, id: inviteId, mobile: pii.mobile })
}

export async function deleteInvitePii(orgId: string, inviteId: string): Promise<void> {
  await deleteInvitePiiRow(orgId, inviteId)
}
