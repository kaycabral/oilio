// Integration test for `mergeStubUserIntoClaimer` (#839). Runs against the
// Firestore emulator via the admin SDK — no mocks. Start the emulator with
// `pnpm --filter @oilio/web db:start` before running.
//
// Each test wipes the emulator state so cases stay independent. We don't
// load Firestore Rules: the merge helper runs server-side and bypasses
// rules in the real app too.

// The admin project id (FIREBASE_ADMIN_PROJECT_ID) and emulator host come from
// the env: the project id from vitest.integration.config.ts `test.env`, the
// host injected by `firebase emulators:exec`. Read directly, never bootstrapped
// here.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import { membershipDocId } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { mergeStubUserIntoClaimer } from './user-merge'

const db = getAdminFirestore()

// Reads a required string field off a Firestore doc with a runtime check,
// avoiding an unsafe `as` cast on the loosely-typed `DocumentData`.
function readStringField(data: FirebaseFirestore.DocumentData | undefined, field: string): string {
  const value: unknown = data?.[field]
  if (typeof value !== 'string') throw new Error(`expected string field "${field}"`)
  return value
}

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  const project = process.env.FIREBASE_ADMIN_PROJECT_ID
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

async function seedStubUser(uid: string, whatsapp: string): Promise<void> {
  await db.collection('users').doc(uid).set({
    uid,
    email: null,
    displayName: 'Stub Customer',
    avatarUrl: null,
    emailVerified: false,
    currentTenantId: null,
    whatsapp,
    birthDate: null,
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: false,
    claimedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

async function seedClaimerUser(uid: string, whatsapp: string | null): Promise<void> {
  const now = new Date().toISOString()
  await db.collection('users').doc(uid).set({
    uid,
    email: 'claimer@example.com',
    displayName: 'Claimer',
    avatarUrl: null,
    emailVerified: true,
    currentTenantId: null,
    whatsapp,
    birthDate: null,
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: false,
    claimedAt: now,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedCustomer(tenantId: string, customerId: string, userId: string): Promise<void> {
  const now = new Date().toISOString()
  await db.collection('tenants').doc(tenantId).collection('customers').doc(customerId).set({
    id: customerId,
    tenantId,
    userId,
    tags: [],
    notes: null,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedMembership(tenantId: string, userId: string, role = 'customer'): Promise<void> {
  const id = membershipDocId(tenantId, userId)
  const now = new Date().toISOString()
  await db
    .collection('memberships')
    .doc(id)
    .set({
      id,
      tenantId,
      userId,
      role,
      status: 'active',
      invitedBy: null,
      joinedAt: now,
      updatedAt: now,
      unitId: null,
      permissions: {
        canHaveAgenda: false,
        canManageOwnAgenda: false,
        canCreateAppointment: false,
        canCancelAppointment: false,
        canManageCustomers: false,
        canManageProfessionals: false,
        canManageServices: false,
        canViewFinancials: false,
        canManagePlans: false,
        canManageSubscriptions: false,
      },
      commissionRate: null,
    })
}

async function seedAppointment(
  tenantId: string,
  apptId: string,
  customerId: string,
  customerUserId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db.collection('tenants').doc(tenantId).collection('appointments').doc(apptId).set({
    id: apptId,
    tenantId,
    unitId: 'unit-1',
    professionalId: 'prof-1',
    customerId,
    serviceId: 'svc-1',
    startAt: now,
    endAt: now,
    status: 'scheduled',
    notes: null,
    customerUserId,
    professionalUserId: null,
    createdAt: now,
    updatedAt: now,
  })
}

beforeAll(async () => {
  await clearFirestore()
})

afterEach(async () => {
  await clearFirestore()
})

describe('mergeStubUserIntoClaimer', () => {
  it('re-points a single Customer and deletes the stub User doc', async () => {
    await seedStubUser('stub-1', '5511999990001')
    await seedClaimerUser('claimer-1', null)
    await seedCustomer('tenant-A', 'cust-1', 'stub-1')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-1',
      claimerUid: 'claimer-1',
    })

    expect(result.customersRepointed).toBe(1)
    expect(result.customersDropped).toBe(0)
    expect(result.tenantsTouched).toEqual(['tenant-A'])

    const customer = await db
      .collection('tenants')
      .doc('tenant-A')
      .collection('customers')
      .doc('cust-1')
      .get()
    expect(readStringField(customer.data(), 'userId')).toBe('claimer-1')

    const stub = await db.collection('users').doc('stub-1').get()
    expect(stub.exists).toBe(false)
  })

  it('re-points Customers across multiple tenants', async () => {
    await seedStubUser('stub-2', '5511999990002')
    await seedClaimerUser('claimer-2', null)
    await seedCustomer('tenant-A', 'cust-A', 'stub-2')
    await seedCustomer('tenant-B', 'cust-B', 'stub-2')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-2',
      claimerUid: 'claimer-2',
    })

    expect(result.customersRepointed).toBe(2)
    expect(result.tenantsTouched.sort()).toEqual(['tenant-A', 'tenant-B'])
  })

  it('drops the stub Customer when claimer already has one in the same tenant', async () => {
    await seedStubUser('stub-3', '5511999990003')
    await seedClaimerUser('claimer-3', null)
    await seedCustomer('tenant-A', 'stub-cust', 'stub-3')
    await seedCustomer('tenant-A', 'claimer-cust', 'claimer-3')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-3',
      claimerUid: 'claimer-3',
    })

    expect(result.customersRepointed).toBe(0)
    expect(result.customersDropped).toBe(1)

    const stubCust = await db
      .collection('tenants')
      .doc('tenant-A')
      .collection('customers')
      .doc('stub-cust')
      .get()
    expect(stubCust.exists).toBe(false)

    const claimerCust = await db
      .collection('tenants')
      .doc('tenant-A')
      .collection('customers')
      .doc('claimer-cust')
      .get()
    expect(claimerCust.exists).toBe(true)
  })

  it('re-points Memberships by recreating at the claimer doc id', async () => {
    await seedStubUser('stub-4', '5511999990004')
    await seedClaimerUser('claimer-4', null)
    await seedMembership('tenant-A', 'stub-4', 'customer')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-4',
      claimerUid: 'claimer-4',
    })

    expect(result.membershipsRepointed).toBe(1)

    const stubMembership = await db
      .collection('memberships')
      .doc(membershipDocId('tenant-A', 'stub-4'))
      .get()
    expect(stubMembership.exists).toBe(false)

    const claimerMembership = await db
      .collection('memberships')
      .doc(membershipDocId('tenant-A', 'claimer-4'))
      .get()
    expect(claimerMembership.exists).toBe(true)
    expect(readStringField(claimerMembership.data(), 'userId')).toBe('claimer-4')
  })

  it('drops the stub Membership when the claimer already has one in the same tenant', async () => {
    await seedStubUser('stub-5', '5511999990005')
    await seedClaimerUser('claimer-5', null)
    await seedMembership('tenant-A', 'stub-5', 'customer')
    await seedMembership('tenant-A', 'claimer-5', 'customer')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-5',
      claimerUid: 'claimer-5',
    })

    expect(result.membershipsRepointed).toBe(0)
    expect(result.membershipsDropped).toBe(1)

    const stubMembership = await db
      .collection('memberships')
      .doc(membershipDocId('tenant-A', 'stub-5'))
      .get()
    expect(stubMembership.exists).toBe(false)
  })

  it('re-points customerUserId on Appointments', async () => {
    await seedStubUser('stub-6', '5511999990006')
    await seedClaimerUser('claimer-6', null)
    await seedCustomer('tenant-A', 'cust-1', 'stub-6')
    await seedAppointment('tenant-A', 'appt-1', 'cust-1', 'stub-6')
    await seedAppointment('tenant-A', 'appt-2', 'cust-1', 'stub-6')

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-6',
      claimerUid: 'claimer-6',
    })

    expect(result.appointmentsRepointed).toBe(2)
    const appt1 = await db
      .collection('tenants')
      .doc('tenant-A')
      .collection('appointments')
      .doc('appt-1')
      .get()
    expect(readStringField(appt1.data(), 'customerUserId')).toBe('claimer-6')
  })

  // (Auditoria via audit_logs removida — ADR 0010 / #1032. O re-point
  // multi-tenant já é coberto por 're-points Customers across multiple tenants'.)

  it('is a no-op when stub and claimer are the same uid', async () => {
    await seedClaimerUser('same-uid', null)

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'same-uid',
      claimerUid: 'same-uid',
    })

    expect(result).toEqual({
      customersRepointed: 0,
      customersDropped: 0,
      membershipsRepointed: 0,
      membershipsDropped: 0,
      appointmentsRepointed: 0,
      tenantsTouched: [],
    })

    const same = await db.collection('users').doc('same-uid').get()
    expect(same.exists).toBe(true)
  })

  it('does nothing when the stub has no references', async () => {
    await seedStubUser('stub-8', '5511999990008')
    await seedClaimerUser('claimer-8', null)

    const result = await mergeStubUserIntoClaimer({
      stubUid: 'stub-8',
      claimerUid: 'claimer-8',
    })

    expect(result.customersRepointed).toBe(0)
    expect(result.membershipsRepointed).toBe(0)
    expect(result.appointmentsRepointed).toBe(0)
    expect(result.tenantsTouched).toEqual([])

    const stub = await db.collection('users').doc('stub-8').get()
    expect(stub.exists).toBe(false)
  })
})
