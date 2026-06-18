import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { AuthzError } from '@/shared/org/membership'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection of a customer doc — only `userId` is read here.
const CustomerUserIdDoc = Schema.Struct({ userId: Schema.optional(Schema.String) })

// Write-guard for the per-org CUSTOMER block (brief 0032, AC-11): pedir
// exclusão rompe o vínculo de cliente — o org não manipula mais o sujeito.
// Any server action that would create a new sale/appointment for, or edit, a
// blocked customer in this org MUST reject (erro à mostra, `AuthzError`).
//
// The block is detected from the `blocked_subjects/{userId}` marker (the fact
// of record). This is the CUSTOMER relationship only — it never guards the
// professional/employment relationship (brief 0041).

// Throws `AuthzError` when `userId` is blocked as a customer in `orgId`.
// Empty `userId` (anonymous walk-in, no platform account) is never blocked.
export async function assertCustomerNotBlocked(orgId: string, userId: string): Promise<void> {
  if (!userId) return
  const marker = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('blocked_subjects')
    .doc(userId)
    .get()
  if (marker.exists) {
    throw new AuthzError(
      `Customer ${userId} is blocked in org ${orgId} — write rejected (LGPD art. 18 block, brief 0032 AC-11)`,
    )
  }
}

// Resolves a customer doc's `userId` then guards it. Convenience for callers
// that hold a `customerId` (appointment/order paths). A missing customer is a
// no-op here — the caller's own "not found" check owns that error.
export async function assertCustomerIdNotBlocked(orgId: string, customerId: string): Promise<void> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('customers')
    .doc(customerId)
    .withConverter(fsConverter(CustomerUserIdDoc))
    .get()
  if (!snap.exists) return
  const userId = snap.data()?.userId ?? ''
  await assertCustomerNotBlocked(orgId, userId)
}
