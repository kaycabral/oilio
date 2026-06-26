import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { AuthzError } from '@/shared/org/membership'
import 'server-only'

// Write-guard for the per-org CUSTOMER block (brief 0032, AC-11): pedir
// exclusão rompe o vínculo de cliente — o org não manipula mais o sujeito.
// Any server action that would create a new sale/appointment for, or edit, a
// blocked customer in this org MUST reject (erro à mostra, `AuthzError`).
//
// The block is detected from the customer shadow's materialized `archived_at`
// (the fail-safe projection of the LGPD block — the fact of record, set
// event-first by `blockSubjectInOrg`; see `customer-read.ts`). This is the
// CUSTOMER relationship only — it never guards the professional/employment
// relationship (brief 0041).

// Throws `AuthzError` when `userId` is blocked as a customer in `orgId`.
// Empty `userId` (anonymous walk-in, no platform account) is never blocked.
export async function assertCustomerNotBlocked(orgId: string, userId: string): Promise<void> {
  if (!userId) return
  // A blocked customer has an archived shadow (`archived_at` set). Probe for any
  // archived shadow of this subject in this org under RLS — existence is enough.
  const rows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM customers
           WHERE org_id = $1 AND user_id = $2 AND archived_at IS NOT NULL LIMIT 1`,
        [orgId, userId],
      )
      .then((res) => res.rows),
  )
  if (rows.length > 0) {
    throw new AuthzError(
      `Customer ${userId} is blocked in org ${orgId} — write rejected (LGPD art. 18 block, brief 0032 AC-11)`,
    )
  }
}

// Resolves a customer doc's `userId` then guards it. Convenience for callers
// that hold a `customerId` (appointment/order paths). A missing customer is a
// no-op here — the caller's own "not found" check owns that error.
export async function assertCustomerIdNotBlocked(orgId: string, customerId: string): Promise<void> {
  // Resolve only the linked `userId`, backend-aware (Postgres typed table under
  // RLS / Firestore subcollection). Uses the tolerant `getCustomerUserId` (not
  // the strict-decoding `getCustomerById`): a guard must stay fail-safe over a
  // degenerate shadow doc, not throw a ParseError. A missing customer is a no-op.
  const userId = await getCustomerUserId(orgId, customerId)
  if (!userId) return
  await assertCustomerNotBlocked(orgId, userId)
}
