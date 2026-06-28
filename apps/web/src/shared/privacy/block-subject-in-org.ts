import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import 'server-only'

// Per-org CUSTOMER erasure via BLOCKING — brief 0032 / #1096 + #1100
// (AC-09/AC-11). Re-scoped 04/06: this is the CUSTOMER relationship only. The
// memberOperation/employment relationship is a DIFFERENT relationship — its PII
// is retained identifiable (legal retention, art. 16) and its severance is the
// establishment's offboarding action (brief 0041 / #1102), NOT this block.
//
// LGPD art. 18 "bloqueio": a data subject erases their CUSTOMER data in ONE
// establishment (org) while keeping their global account and other orgs
// intact. This is NOT the irreversible account anonymization (#1093) — the
// global `users/{uid}` doc is untouched; only this org's view of the
// customer is severed.
//
// The block, within the single org (no cross-org query — ADR 0004; all reads
// start from `orgs/{orgId}`): ARCHIVE the customer shadow — set `archivedAt` on
// the `customers` projection for this userId. Customer is event-sourced (ADR
// 0010), so this is EVENT-FIRST — `customer.updated {archivedAt}` via `emitEvent`
// (the projection writes the row in the same transaction). NEVER a direct write
// (that's the banned dual-write).
//
// The archived shadow IS the fact of record: post-cutover (brief 0062) there is
// no separate `blocked_subjects` table — the block is the materialized
// `archived_at` on the customer shadow (the fail-safe, self-describing
// projection the name/avatar resolvers key off to render the neutral
// `Cliente ‹CODE›` label + blank avatar, AC-13; see `customer-read.ts`). The
// write-guard (`assertCustomerNotBlocked`) reads the same `archived_at`.
//
// The customer has NO own `_pii` doc (PII lives in the global `users/{uid}`),
// so there is nothing else to scrub per-org. There is intentionally NO scrub
// of `member_operations_pii`/`invites_pii` here — those are memberOperation-relationship
// PII (brief 0041).

export type BlockSubjectResult = {
  // Whether the subject was blocked in this org (false only for an empty userId).
  blocked: boolean
  // Count of customer shadow docs archived in this org for the subject.
  archivedCustomers: number
  // Whether the subject had an active subscription in this org that the
  // erasure cascade cancelled (brief 0032 / #1101, AC-12). Surfaced so the
  // caller can report the informed-consent fact ("an active subscription was
  // cancelled") after the block.
  hadActiveSubscription: boolean
}

// Blocks `userId` as a CUSTOMER in `orgId`: writes the marker and archives
// the subject's customer shadow(s). The global account is NOT touched. An empty
// `userId` (an anonymous walk-in with no platform account) is a no-op.
// Idempotent: re-running re-stamps the marker and re-archives.
//
// Authorization is the CALLER's responsibility — invoke only from a server
// action that has already passed `requireManagerCtx` (owner/manager of the
// org) or has verified the subject is acting on themselves scoped to this
// org. Mirrors how `anonymizeAccount` trusts its `actions.ts` gate.
export async function blockSubjectInOrg(
  orgId: string,
  userId: string,
): Promise<BlockSubjectResult> {
  // Anonymous subject (no platform account) — nothing to block or archive.
  if (!userId) return { blocked: false, archivedCustomers: 0, hadActiveSubscription: false }

  // 1. Erasure cascade (brief 0032 / #1101): cancel the subject's active
  //    subscription immediately (+ stop its pending charges) and cancel their
  //    future appointments IN THIS ORG. Saga step — idempotent + errors
  //    surface (AC-12 / AC-14). Run before archiving so the cancel events are
  //    ordered before the terminal shadow archive.
  const cascade = await eraseCustomerCascadeInOrg(orgId, userId)

  // 2. Archive the customer shadow(s) — event-first (saga step). The archived
  //    shadow IS the block (fact of record). Errors surface.
  const archivedCustomers = await archiveCustomerShadows(orgId, userId)

  return {
    blocked: true,
    archivedCustomers,
    hadActiveSubscription: cascade.hadActiveSubscription,
  }
}

// Sets `archivedAt` on every customer shadow for `userId` in this org,
// EVENT-FIRST. The customer aggregate is event-sourced, so each doc gets a
// `customer.updated { changes: { archivedAt } }` event — the reducer projects
// the field on the doc in the same transaction. Within-org query (allowed).
async function archiveCustomerShadows(orgId: string, userId: string): Promise<number> {
  // Read the subject's customer shadow ids in this org under RLS (within-org).
  const customerIds = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM customers WHERE org_id = $1 AND user_id = $2', [orgId, userId])
      .then((res) => res.rows),
  )

  let archived = 0
  for (const { id } of customerIds) {
    const now = new Date().toISOString()
    const res = await emitEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, id), {
      _tag: 'customer.updated',
      actorId: userId,
      payload: { changes: { archivedAt: now } },
    })
    // Erro à mostra — a partial archive is retryable (idempotent re-run), never
    // silent: surface so the saga can be retried/compensated upstream.
    if (!res.ok) throw new Error(`Failed to archive customer ${id}: ${res.error}`)
    archived += 1
  }
  return archived
}
