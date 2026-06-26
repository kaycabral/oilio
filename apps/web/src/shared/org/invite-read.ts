// Server-side reads that hydrate Invite docs with the invitee email from the
// per-org `invites_pii/{id}` collection. Mirrors `customer-read.ts` (the
// reference LGPD pattern): the immutable event payload + projection carry NO
// PII; the email lives in a separate mutable/deletable doc and is merged at
// read time. See #1036 + ADR 0010 (PII fora de evento — direito à
// eliminação / LGPD).

import { StoredInvite, type Invite, type InvitePii } from '@/domain'
import { rowToDoc, type InviteRow } from '@/shared/db/pg/effect/invite-projector'
import {
  deleteInvitePii as deleteInvitePiiRow,
  getInvitePiiByIds,
  upsertInvitePii,
} from '@/shared/db/pg/pii-sidecars-store'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

// What we actually persist under `orgs/{t}/invites/{id}` (the event
// projection) + the deletable PII doc at `invites_pii/{id}` (`InvitePii`,
// holding `email`). Both re-exported from `@/domain` (read-model
// source-of-truth) so existing importers (`team.actions`, `offboard-member`)
// keep resolving them from here.
export type { InvitePii, StoredInvite } from '@/domain'

const decodeStoredInvite = Schema.decodeUnknownSync(StoredInvite)

function mergeWithPii(i: StoredInvite, pii: InvitePii | undefined): Invite {
  return { ...i, email: pii?.email ?? '' }
}

// Hydrate the deletable invite email sidecar by invite id — the typed
// `invites_pii` table under org RLS (cutover, brief 0062). Empty ids filtered.
async function fetchPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, InvitePii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  return getInvitePiiByIds(orgId, unique)
}

// Hydrate a batch of Invite docs in one round-trip to the PII collection.
// Order is preserved.
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

// List all invites for a org, enriched with the invitee email. Reads the typed
// `invites` table under RLS.
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

// Invites in a given status (e.g. `pending`), enriched with the invitee email.
// Filters `WHERE org_id AND status` under RLS. Used by the offboarding cascade
// to find pending invites to revoke.
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

// Write the PII sidecar directly (mutable, deletable, NOT event-sourced). Called
// from the create-invite action alongside the domain event emission. Backed by
// the typed `invites_pii` table (org RLS).
export async function writeInvitePii(
  orgId: string,
  inviteId: string,
  pii: InvitePii,
): Promise<void> {
  await upsertInvitePii({ orgId, id: inviteId, email: pii.email })
}

// Delete the PII sidecar (LGPD erasure) — the invitee email is the only PII it
// holds and it is deletable / not replayed. Used by the account anonymization
// flow (brief 0032 / #1093) to scrub the subject's invite emails.
export async function deleteInvitePii(orgId: string, inviteId: string): Promise<void> {
  await deleteInvitePiiRow(orgId, inviteId)
}
