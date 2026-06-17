// Integration test for the identity-layer reverse index (#1097 / brief 0032
// AC-10). Runs against the Firestore emulator via the admin SDK — no mocks.
//
// Covers: the saga-step write on customer creation (`upsertCustomerWithUser`
// writes `users/{uid}/tenant_links/{tenantId}`), idempotency, the per-user
// reads (`listLinkedTenantIds`/`isLinkedToTenant`/`listMyCustomerEstablishments`),
// and the zero-PII invariant — the index doc carries ONLY references.
//
// The shared (default) emulator db is wiped between test FILES; vitest runs
// files in parallel, so every fixture uses a per-run-unique id and reads target
// only our own ids (never a global wipe).

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import type { TenantLink } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { upsertCustomerWithUser } from '@/shared/tenant/customer-upsert'
import {
  isLinkedToTenant,
  linkCustomerTenant,
  listLinkedTenantIds,
  listMyCustomerEstablishments,
} from './tenant-links'

const db = getAdminFirestore()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function asTenantLink(data: FirebaseFirestore.DocumentData | undefined): TenantLink {
  if (
    data === undefined ||
    typeof data.tenantId !== 'string' ||
    typeof data.linkedAt !== 'string'
  ) {
    throw new Error('expected a TenantLink-shaped doc')
  }
  return { tenantId: data.tenantId, linkedAt: data.linkedAt }
}

async function seedTenantDoc(tenantId: string, name: string): Promise<void> {
  await db.collection('tenants').doc(tenantId).set({ id: tenantId, name })
}

describe('tenant-links reverse index', () => {
  it('linkCustomerTenant writes a references-only doc (zero PII) and is idempotent', async () => {
    const userId = uniqueId('user')
    const tenantId = uniqueId('tenant')

    await linkCustomerTenant(userId, tenantId)
    const ref = db.collection('users').doc(userId).collection('tenant_links').doc(tenantId)
    const first = await ref.get()
    expect(first.exists).toBe(true)
    const data = asTenantLink(first.data())
    // Zero PII — the doc carries ONLY references: tenantId + linkedAt.
    expect(Object.keys(data).sort()).toEqual(['linkedAt', 'tenantId'])
    expect(data.tenantId).toBe(tenantId)
    expect(data.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const firstLinkedAt = data.linkedAt

    // Idempotent: re-linking does not duplicate or rewrite `linkedAt`.
    await linkCustomerTenant(userId, tenantId)
    const second = await ref.get()
    expect(asTenantLink(second.data()).linkedAt).toBe(firstLinkedAt)
    const all = await db.collection('users').doc(userId).collection('tenant_links').get()
    expect(all.size).toBe(1)
  })

  it('listLinkedTenantIds / isLinkedToTenant read ONLY the subject own index', async () => {
    const userId = uniqueId('user')
    const tenantA = uniqueId('tenant')
    const tenantB = uniqueId('tenant')
    const otherUser = uniqueId('user')
    const otherTenant = uniqueId('tenant')

    await linkCustomerTenant(userId, tenantA)
    await linkCustomerTenant(userId, tenantB)
    await linkCustomerTenant(otherUser, otherTenant)

    const linked = await listLinkedTenantIds(userId)
    expect(linked.sort()).toEqual([tenantA, tenantB].sort())
    // The other subject's links are NOT visible — per-user scope.
    expect(linked).not.toContain(otherTenant)

    expect(await isLinkedToTenant(userId, tenantA)).toBe(true)
    expect(await isLinkedToTenant(userId, otherTenant)).toBe(false)
    expect(await listLinkedTenantIds(uniqueId('nobody'))).toEqual([])
    expect(await listLinkedTenantIds('')).toEqual([])
  })

  it('listMyCustomerEstablishments resolves business names from tenant docs', async () => {
    const userId = uniqueId('user')
    const tenantA = uniqueId('tenant')
    const tenantB = uniqueId('tenant')
    await seedTenantDoc(tenantA, 'Barbearia Zebra')
    await seedTenantDoc(tenantB, 'Barbearia Alfa')
    await linkCustomerTenant(userId, tenantA)
    await linkCustomerTenant(userId, tenantB)

    const ests = await listMyCustomerEstablishments(userId)
    // Sorted by name.
    expect(ests.map((e) => e.name)).toEqual(['Barbearia Alfa', 'Barbearia Zebra'])
    expect(ests.map((e) => e.tenantId).sort()).toEqual([tenantA, tenantB].sort())
  })

  it('upsertCustomerWithUser writes the reverse-index link as a saga step (write-path)', async () => {
    const tenantId = uniqueId('tenant')
    const whatsapp = `+5511${Date.now()}`.slice(0, 14)

    const res = await upsertCustomerWithUser({
      tenantId,
      name: 'Cliente Saga',
      whatsappRaw: whatsapp,
      email: null,
      birthDate: null,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // The customer-creation saga linked the subject to this tenant.
    expect(await isLinkedToTenant(res.userId, tenantId)).toBe(true)

    // Re-booking (existing customer) does not re-link / duplicate.
    const res2 = await upsertCustomerWithUser({
      tenantId,
      name: 'Cliente Saga',
      whatsappRaw: whatsapp,
      email: null,
      birthDate: null,
    })
    expect(res2.ok).toBe(true)
    const links = await db.collection('users').doc(res.userId).collection('tenant_links').get()
    expect(links.size).toBe(1)
  })
})
