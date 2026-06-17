import type { BlockedSubject } from '@/domain'
import { CustomerConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { eraseCustomerCascadeInTenant } from '@/shared/privacy/erase-customer-cascade'
import 'server-only'

// Per-tenant CUSTOMER erasure via BLOCKING — brief 0032 / #1096 + #1100
// (AC-09/AC-11). Re-scoped 04/06: this is the CUSTOMER relationship only. The
// professional/employment relationship is a DIFFERENT relationship — its PII
// is retained identifiable (legal retention, art. 16) and its severance is the
// establishment's offboarding action (brief 0041 / #1102), NOT this block.
//
// LGPD art. 18 "bloqueio": a data subject erases their CUSTOMER data in ONE
// establishment (tenant) while keeping their global account and other tenants
// intact. This is NOT the irreversible account anonymization (#1093) — the
// global `users/{uid}` doc is untouched; only this tenant's view of the
// customer is severed.
//
// Two effects, both within the single tenant (no cross-tenant query — ADR
// 0004; all reads start from `tenants/{tenantId}`):
//   1. Write the marker `tenants/{tenantId}/blocked_subjects/{userId}` with
//      `{ blockedAt }` — the FACT of record (CQRS source of truth). The name/
//      avatar resolvers load this small set per request and render the neutral
//      `Cliente ‹CODE›` label (+ blank avatar, AC-13) in this tenant.
//   2. ARCHIVE the customer shadow: set `archivedAt` on `tenants/{t}/customers`
//      docs for this userId. Customer is event-sourced (ADR 0010), so this is
//      EVENT-FIRST — `customer.updated {archivedAt}` via `emitEvent` (the
//      projection writes the doc in the same transaction). NEVER a direct
//      `.set` (that's the banned dual-write) and NEVER a cross-aggregate
//      transaction (CLAUDE.md: "cascata = saga, nunca transação única"). It is
//      a saga step: marker → customer event, each with errors surfaced.
//
// The customer has NO own `_pii` doc (PII lives in the global `users/{uid}`),
// so there is nothing else to scrub per-tenant. There is intentionally NO scrub
// of `professionals_pii`/`invites_pii` here — those are professional-relationship
// PII (brief 0041).

export type BlockSubjectResult = {
  // Whether the per-tenant marker was written (false only for an empty userId).
  blocked: boolean
  // Count of customer shadow docs archived in this tenant for the subject.
  archivedCustomers: number
  // Whether the subject had an active subscription in this tenant that the
  // erasure cascade cancelled (brief 0032 / #1101, AC-12). Surfaced so the
  // caller can report the informed-consent fact ("an active subscription was
  // cancelled") after the block.
  hadActiveSubscription: boolean
}

// Blocks `userId` as a CUSTOMER in `tenantId`: writes the marker and archives
// the subject's customer shadow(s). The global account is NOT touched. An empty
// `userId` (an anonymous walk-in with no platform account) is a no-op.
// Idempotent: re-running re-stamps the marker and re-archives.
//
// Authorization is the CALLER's responsibility — invoke only from a server
// action that has already passed `requireManagerCtx` (owner/manager of the
// tenant) or has verified the subject is acting on themselves scoped to this
// tenant. Mirrors how `anonymizeAccount` trusts its `actions.ts` gate.
export async function blockSubjectInTenant(
  tenantId: string,
  userId: string,
): Promise<BlockSubjectResult> {
  // Anonymous subject (no platform account) — nothing to block or archive.
  if (!userId) return { blocked: false, archivedCustomers: 0, hadActiveSubscription: false }

  const db = getAdminFirestore()
  const now = new Date().toISOString()

  // 1. Write the blocking marker (server-side; ISO timestamp). PII-free — it
  //    holds only the proof timestamp keyed by the opaque userId. This is the
  //    fact of record; the archived shadow is its materialized projection.
  const marker: BlockedSubject = { blockedAt: now }
  await db
    .collection('tenants')
    .doc(tenantId)
    .collection('blocked_subjects')
    .doc(userId)
    .set(marker)

  // 2. Erasure cascade (brief 0032 / #1101): cancel the subject's active
  //    subscription immediately (+ stop its pending charges) and cancel their
  //    future appointments IN THIS TENANT. Saga step — idempotent + errors
  //    surface (AC-12 / AC-14). Run before archiving so the cancel events are
  //    ordered before the terminal shadow archive.
  const cascade = await eraseCustomerCascadeInTenant(tenantId, userId)

  // 3. Archive the customer shadow(s) — event-first (saga step). Errors surface.
  const archivedCustomers = await archiveCustomerShadows(tenantId, userId)

  return {
    blocked: true,
    archivedCustomers,
    hadActiveSubscription: cascade.hadActiveSubscription,
  }
}

// Sets `archivedAt` on every customer shadow for `userId` in this tenant,
// EVENT-FIRST. The customer aggregate is event-sourced, so each doc gets a
// `customer.updated { changes: { archivedAt } }` event — the reducer projects
// the field on the doc in the same transaction. Within-tenant query (allowed).
async function archiveCustomerShadows(tenantId: string, userId: string): Promise<number> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('customers')
    .where('userId', '==', userId)
    .get()

  let archived = 0
  for (const doc of snap.docs) {
    const now = new Date().toISOString()
    const res = await emitEvent(CustomerConfig, `tenants/${tenantId}/customers/${doc.id}`, {
      _tag: 'customer.updated',
      actorId: userId,
      payload: { changes: { archivedAt: now } },
    })
    // Erro à mostra — a partial archive is retryable (idempotent re-run), never
    // silent: surface so the saga can be retried/compensated upstream.
    if (!res.ok) throw new Error(`Failed to archive customer ${doc.id}: ${res.error}`)
    archived += 1
  }
  return archived
}
