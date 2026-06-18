// Integration test for `blockSubjectInOrg` (#1096 + #1100 / brief 0032
// AC-09/AC-11). Runs against the Firestore emulator via the admin SDK — no
// mocks. The marker write + the event-first customer archive run server-side
// and bypass Rules in the real app too.
//
// Re-scoped 04/06: this is the CUSTOMER relationship only. The block writes the
// `blocked_subjects/{userId}` marker AND archives the customer shadow(s) via
// `customer.updated {archivedAt}` (event-first). There is NO scrub of
// `professionals_pii`/`invites_pii` — that's the professional relationship
// (brief 0041), retained identifiable.
//
// The admin project id (FIREBASE_ADMIN_PROJECT_ID) and emulator host come from
// the env: the project id from vitest.integration.config.ts `test.env`, the
// host injected by `firebase emulators:exec`. Read directly, never bootstrapped.
//
// The shared (default) emulator db is wiped between test FILES, but vitest runs
// files in parallel — a global DELETE would clobber a sibling suite mid-run. So
// every fixture here uses a per-run-unique org/user id (Date.now + counter)
// and we never wipe globally; reads target only our own ids.

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import type { BlockedSubject } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { blockSubjectInOrg } from './block-subject-in-org'

const db = getAdminFirestore()

// Narrows the loosely-typed `DocumentData` to `BlockedSubject` with a runtime
// check, avoiding an unsafe `as` cast.
function asBlockedSubject(data: FirebaseFirestore.DocumentData | undefined): BlockedSubject {
  if (data === undefined || typeof data.blockedAt !== 'string') {
    throw new Error('expected a BlockedSubject-shaped doc')
  }
  return { blockedAt: data.blockedAt }
}

// Reads a required string field off a Firestore doc with a runtime check.
function readStringField(data: FirebaseFirestore.DocumentData | undefined, field: string): string {
  const value: unknown = data?.[field]
  if (typeof value !== 'string') throw new Error(`expected string field "${field}"`)
  return value
}

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedUser(uid: string, email: string | null): Promise<void> {
  const now = new Date().toISOString()
  await db
    .collection('users')
    .doc(uid)
    .set({
      uid,
      email,
      displayName: 'Subject Name',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      currentOrgId: null,
      whatsapp: '5511900000000',
      birthDate: null,
      taxIdentity: { kind: 'individual', taxId: '39053344705' },
      bio: null,
      specialties: null,
      completionCompleted: true,
      claimedAt: now,
      termsAcceptedAt: null,
      termsVersion: null,
      privacyAcceptedAt: null,
      privacyVersion: null,
      anonymizedAt: null,
      createdAt: now,
      updatedAt: now,
    })
}

// Seeds a customer shadow doc for a userId in a org. The stored shape carries
// no PII — only the operational projection + the userId FK. Returns the id.
async function seedCustomerShadow(orgId: string, userId: string): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('customers').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    userId,
    tags: [],
    notes: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return ref.id
}

describe('blockSubjectInOrg (customer-scoped)', () => {
  it('writes the marker and archives the customer shadow in that org only; global account intact', async () => {
    const userId = uniqueId('subject')
    const email = `${userId}@example.com`
    const orgA = uniqueId('org')
    await seedUser(userId, email)
    const customerId = await seedCustomerShadow(orgA, userId)
    const orgRef = db.collection('orgs').doc(orgA)

    const result = await blockSubjectInOrg(orgA, userId)

    expect(result.blocked).toBe(true)
    expect(result.archivedCustomers).toBe(1)
    // No subscription seeded — cascade reports no active subscription.
    expect(result.hadActiveSubscription).toBe(false)

    // Marker written with an ISO timestamp.
    const marker = await orgRef.collection('blocked_subjects').doc(userId).get()
    expect(marker.exists).toBe(true)
    expect(asBlockedSubject(marker.data()).blockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Customer shadow archived (event-first projection set `archivedAt`).
    const customer = await orgRef.collection('customers').doc(customerId).get()
    expect(customer.exists).toBe(true)
    expect(readStringField(customer.data(), 'archivedAt')).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // The global account is untouched (terminal-at-rest bloqueio, not anon).
    const user = (await db.collection('users').doc(userId).get()).data()
    expect(user?.displayName).toBe('Subject Name')
    expect(user?.email).toBe(email)
    expect(user?.avatarUrl).toBe('https://example.com/avatar.png')
    expect(user?.anonymizedAt).toBeNull()
  })

  it('does not leak into a second org where the subject is also a customer', async () => {
    const userId = uniqueId('subject')
    const email = `${userId}@example.com`
    const orgA = uniqueId('org')
    const orgB = uniqueId('org')
    await seedUser(userId, email)
    const custA = await seedCustomerShadow(orgA, userId)
    const custB = await seedCustomerShadow(orgB, userId)
    const refA = db.collection('orgs').doc(orgA)
    const refB = db.collection('orgs').doc(orgB)

    await blockSubjectInOrg(orgA, userId)

    // Org A archived + marked.
    expect((await refA.collection('blocked_subjects').doc(userId).get()).exists).toBe(true)
    expect((await refA.collection('customers').doc(custA).get()).data()?.archivedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    )

    // Org B fully intact — no marker, shadow not archived.
    expect((await refB.collection('blocked_subjects').doc(userId).get()).exists).toBe(false)
    expect((await refB.collection('customers').doc(custB).get()).data()?.archivedAt).toBeNull()
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    const result = await blockSubjectInOrg(uniqueId('org'), '')
    expect(result).toEqual({ blocked: false, archivedCustomers: 0, hadActiveSubscription: false })
  })
})
