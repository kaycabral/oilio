// Integration test for the per-org CUSTOMER write-guard (brief 0032, AC-11).
// Runs against the Firestore emulator via the admin SDK — no mocks. A blocked
// customer's relationship is severed: any new sale/appointment for, or edit of,
// that customer in the org must be rejected (`AuthzError`, erro à mostra).
//
// Per-run-unique ids (Date.now + counter) so the parallel vitest file runner
// never clobbers a sibling suite — no global wipe.

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import { getAdminFirestore } from '@/shared/db'
import { AuthzError } from '@/shared/org/membership'
import { assertCustomerIdNotBlocked, assertCustomerNotBlocked } from './assert-customer-not-blocked'

const db = getAdminFirestore()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedCustomerShadow(orgId: string, userId: string): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('customers').doc()
  await ref.set({
    id: ref.id,
    orgId,
    userId,
    tags: [],
    notes: null,
    archivedAt: null,
  })
  return ref.id
}

async function writeMarker(orgId: string, userId: string): Promise<void> {
  await db
    .collection('orgs')
    .doc(orgId)
    .collection('blocked_subjects')
    .doc(userId)
    .set({ blockedAt: new Date().toISOString() })
}

describe('assertCustomerNotBlocked', () => {
  it('rejects a blocked customer (by userId)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await writeMarker(orgId, userId)
    await expect(assertCustomerNotBlocked(orgId, userId)).rejects.toBeInstanceOf(AuthzError)
  })

  it('allows a non-blocked customer (by userId)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    await expect(assertCustomerNotBlocked(orgId, userId)).resolves.toBeUndefined()
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    await expect(assertCustomerNotBlocked(uniqueId('org'), '')).resolves.toBeUndefined()
  })

  it('rejects via customerId when the resolved subject is blocked', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const customerId = await seedCustomerShadow(orgId, userId)
    await writeMarker(orgId, userId)
    await expect(assertCustomerIdNotBlocked(orgId, customerId)).rejects.toBeInstanceOf(AuthzError)
  })

  it('allows via customerId when the subject is not blocked', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const customerId = await seedCustomerShadow(orgId, userId)
    await expect(assertCustomerIdNotBlocked(orgId, customerId)).resolves.toBeUndefined()
  })

  it('is a no-op for a missing customer (caller owns the not-found error)', async () => {
    const orgId = uniqueId('org')
    await expect(assertCustomerIdNotBlocked(orgId, uniqueId('missing'))).resolves.toBeUndefined()
  })
})
