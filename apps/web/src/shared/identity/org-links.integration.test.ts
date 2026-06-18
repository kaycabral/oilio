// Integration test for the identity-layer reverse index (#1097 / brief 0032
// AC-10). Runs against the Firestore emulator via the admin SDK — no mocks.
//
// Covers: the saga-step write on customer creation (`upsertCustomerWithUser`
// writes `users/{uid}/org_links/{orgId}`), idempotency, the per-user
// reads (`listLinkedOrgIds`/`isLinkedToOrg`/`listMyCustomerEstablishments`),
// and the zero-PII invariant — the index doc carries ONLY references.
//
// The shared (default) emulator db is wiped between test FILES; vitest runs
// files in parallel, so every fixture uses a per-run-unique id and reads target
// only our own ids (never a global wipe).

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import type { OrgLink } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import {
  isLinkedToOrg,
  linkCustomerOrg,
  listLinkedOrgIds,
  listMyCustomerEstablishments,
} from './org-links'

const db = getAdminFirestore()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function asOrgLink(data: FirebaseFirestore.DocumentData | undefined): OrgLink {
  if (data === undefined || typeof data.orgId !== 'string' || typeof data.linkedAt !== 'string') {
    throw new Error('expected a OrgLink-shaped doc')
  }
  return { orgId: data.orgId, linkedAt: data.linkedAt }
}

async function seedOrgDoc(orgId: string, name: string): Promise<void> {
  await db.collection('orgs').doc(orgId).set({ id: orgId, name })
}

describe('org-links reverse index', () => {
  it('linkCustomerOrg writes a references-only doc (zero PII) and is idempotent', async () => {
    const userId = uniqueId('user')
    const orgId = uniqueId('org')

    await linkCustomerOrg(userId, orgId)
    const ref = db.collection('users').doc(userId).collection('org_links').doc(orgId)
    const first = await ref.get()
    expect(first.exists).toBe(true)
    const data = asOrgLink(first.data())
    // Zero PII — the doc carries ONLY references: orgId + linkedAt.
    expect(Object.keys(data).sort()).toEqual(['linkedAt', 'orgId'])
    expect(data.orgId).toBe(orgId)
    expect(data.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const firstLinkedAt = data.linkedAt

    // Idempotent: re-linking does not duplicate or rewrite `linkedAt`.
    await linkCustomerOrg(userId, orgId)
    const second = await ref.get()
    expect(asOrgLink(second.data()).linkedAt).toBe(firstLinkedAt)
    const all = await db.collection('users').doc(userId).collection('org_links').get()
    expect(all.size).toBe(1)
  })

  it('listLinkedOrgIds / isLinkedToOrg read ONLY the subject own index', async () => {
    const userId = uniqueId('user')
    const orgA = uniqueId('org')
    const orgB = uniqueId('org')
    const otherUser = uniqueId('user')
    const otherOrg = uniqueId('org')

    await linkCustomerOrg(userId, orgA)
    await linkCustomerOrg(userId, orgB)
    await linkCustomerOrg(otherUser, otherOrg)

    const linked = await listLinkedOrgIds(userId)
    expect(linked.sort()).toEqual([orgA, orgB].sort())
    // The other subject's links are NOT visible — per-user scope.
    expect(linked).not.toContain(otherOrg)

    expect(await isLinkedToOrg(userId, orgA)).toBe(true)
    expect(await isLinkedToOrg(userId, otherOrg)).toBe(false)
    expect(await listLinkedOrgIds(uniqueId('nobody'))).toEqual([])
    expect(await listLinkedOrgIds('')).toEqual([])
  })

  it('listMyCustomerEstablishments resolves business names from org docs', async () => {
    const userId = uniqueId('user')
    const orgA = uniqueId('org')
    const orgB = uniqueId('org')
    await seedOrgDoc(orgA, 'Barbearia Zebra')
    await seedOrgDoc(orgB, 'Barbearia Alfa')
    await linkCustomerOrg(userId, orgA)
    await linkCustomerOrg(userId, orgB)

    const ests = await listMyCustomerEstablishments(userId)
    // Sorted by name.
    expect(ests.map((e) => e.name)).toEqual(['Barbearia Alfa', 'Barbearia Zebra'])
    expect(ests.map((e) => e.orgId).sort()).toEqual([orgA, orgB].sort())
  })

  it('upsertCustomerWithUser writes the reverse-index link as a saga step (write-path)', async () => {
    const orgId = uniqueId('org')
    const whatsapp = `+5511${Date.now()}`.slice(0, 14)

    const res = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente Saga',
      whatsappRaw: whatsapp,
      email: null,
      birthDate: null,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // The customer-creation saga linked the subject to this org.
    expect(await isLinkedToOrg(res.userId, orgId)).toBe(true)

    // Re-booking (existing customer) does not re-link / duplicate.
    const res2 = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente Saga',
      whatsappRaw: whatsapp,
      email: null,
      birthDate: null,
    })
    expect(res2.ok).toBe(true)
    const links = await db.collection('users').doc(res.userId).collection('org_links').get()
    expect(links.size).toBe(1)
  })
})
