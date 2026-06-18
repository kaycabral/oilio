import { defaultPermissionsForRole, membershipDocId, type Role } from '@/domain'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

const PROJECT_ID = 'scheduling-rules-test'
const RULES_PATH = path.resolve(__dirname, '../../../../firestore.rules')

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  // host/port omitted on purpose: initializeTestEnvironment auto-discovers the
  // emulator from the env injected by `firebase emulators:exec` (the canonical
  // path — see firebase-js-sdk rules-unit-testing discovery).
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  })
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

afterAll(async () => {
  await testEnv.cleanup()
})

async function seedMembership(
  orgId: string,
  userId: string,
  role: Role = 'owner',
  status: 'active' | 'suspended' | 'revoked' = 'active',
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await db
      .collection('memberships')
      .doc(membershipDocId(orgId, userId))
      .set({
        id: membershipDocId(orgId, userId),
        orgId,
        userId,
        role,
        status,
        invitedBy: null,
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        unitId: null,
        permissions: defaultPermissionsForRole(role),
        commissionRate: null,
      })
  })
}

async function seedOrg(orgId: string, ownerUserId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('orgs').doc(orgId).set({
      id: orgId,
      name: 'Test Org',
      slug: orgId,
      vertical: 'barbershop',
      taxIdentity: null,
      ownerUserId,
      selfBookingPublished: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })
}

describe('users collection', () => {
  it('user can read and write only their own doc', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice.collection('users').doc('alice').set({ uid: 'alice', email: 'a@x.com' }),
    )
    await assertFails(alice.collection('users').doc('bob').set({ uid: 'bob', email: 'b@x.com' }))
  })

  it('unauthenticated cannot read', async () => {
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(anon.collection('users').doc('alice').get())
  })
})

describe('users/{uid}/org_links (reverse index — #1097)', () => {
  async function seedLink(uid: string, orgId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .doc(`users/${uid}/org_links/${orgId}`)
        .set({ orgId, linkedAt: new Date().toISOString() })
    })
  }

  it('owner can read their own org_links', async () => {
    await seedLink('alice', 't1')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(alice.doc('users/alice/org_links/t1').get())
  })

  it('a different user cannot read someone else org_links', async () => {
    await seedLink('alice', 't1')
    const eve = testEnv.authenticatedContext('eve').firestore()
    await assertFails(eve.doc('users/alice/org_links/t1').get())
  })

  it('client writes are denied even for the owner (server-side only)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.doc('users/alice/org_links/t1').set({ orgId: 't1', linkedAt: 'now' }))
  })
})

describe('orgs collection', () => {
  it('owner can read their org', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(alice.collection('orgs').doc('t1').get())
  })

  it('non-member cannot read the org', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const eve = testEnv.authenticatedContext('eve').firestore()
    await assertFails(eve.collection('orgs').doc('t1').get())
  })

  it('manager cannot delete the org', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'mallory', 'manager')
    const mallory = testEnv.authenticatedContext('mallory').firestore()
    await assertFails(mallory.collection('orgs').doc('t1').delete())
  })

  it('owner can update the org', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice.collection('orgs').doc('t1').update({ name: 'Renamed', updatedAt: 'now' }),
    )
  })

  it('user can create org where they are owner', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice.collection('orgs').doc('t1').set({
        id: 't1',
        name: 'New',
        slug: 'new',
        vertical: 'barbershop',
        taxIdentity: null,
        ownerUserId: 'alice',
        selfBookingPublished: false,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    )
  })

  it('user cannot create a org owned by someone else', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      alice.collection('orgs').doc('t1').set({
        id: 't1',
        name: 'New',
        slug: 'new',
        vertical: 'barbershop',
        taxIdentity: null,
        ownerUserId: 'bob',
        selfBookingPublished: false,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    )
  })
})

describe('org subcollections (units / professionals / customers)', () => {
  it('member can read units; non-member cannot', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('units')
        .doc('u1')
        .set({ id: 'u1', orgId: 't1', name: 'Unit 1' })
    })

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(alice.collection('orgs').doc('t1').collection('units').doc('u1').get())

    const eve = testEnv.authenticatedContext('eve').firestore()
    await assertFails(eve.collection('orgs').doc('t1').collection('units').doc('u1').get())
  })

  it('owner can create unit; receptionist cannot', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t1', 'rita', 'receptionist')

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('units')
        .doc('u1')
        .set({ name: 'U1', slug: 'unit-1' }),
    )

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertFails(
      rita
        .collection('orgs')
        .doc('t1')
        .collection('units')
        .doc('u2')
        .set({ name: 'U2', slug: 'unit-2' }),
    )
  })

  it('cannot create unit without slug (or with too short / too long slug)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    const units = alice.collection('orgs').doc('t1').collection('units')

    // Missing slug
    await assertFails(units.doc('u1').set({ name: 'U1' }))
    // Slug too short
    await assertFails(units.doc('u2').set({ name: 'U2', slug: 'ab' }))
    // Slug too long
    await assertFails(units.doc('u3').set({ name: 'U3', slug: 'a'.repeat(65) }))
    // Slug present & sized — passes
    await assertSucceeds(units.doc('u4').set({ name: 'U4', slug: 'matriz' }))
  })

  it('cannot create professional without unitIds (or with empty list)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()

    // Empty unitIds rejected (userId present so unitIds is the only failing rule)
    await assertFails(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p1')
        .set({ id: 'p1', orgId: 't1', name: 'Pro', userId: 'u-pro', unitIds: [] }),
    )

    // Missing unitIds rejected
    await assertFails(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p2')
        .set({ id: 'p2', orgId: 't1', name: 'Pro', userId: 'u-pro' }),
    )

    // With ≥1 unit OK (userId required since #1045; operationalStatus must be
    // 'incomplete' on create since #1047; serviceIds required as list — empty allowed)
    await assertSucceeds(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p3')
        .set({
          id: 'p3',
          orgId: 't1',
          name: 'Pro',
          userId: 'u-pro',
          unitIds: ['u1'],
          serviceIds: [],
          operationalStatus: 'incomplete',
        }),
    )
  })

  it('cannot update professional to empty unitIds', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p1')
        .set({
          id: 'p1',
          orgId: 't1',
          name: 'Pro',
          userId: 'u-pro',
          unitIds: ['u1'],
          serviceIds: [],
        })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p1')
        .update({ unitIds: [] }),
    )
  })

  it('only owner can delete a professional; manager cannot', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t1', 'maya', 'manager')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('professionals')
        .doc('p1')
        .set({ id: 'p1', orgId: 't1', name: 'Pro' })
    })

    const maya = testEnv.authenticatedContext('maya').firestore()
    await assertFails(
      maya.collection('orgs').doc('t1').collection('professionals').doc('p1').delete(),
    )

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice.collection('orgs').doc('t1').collection('professionals').doc('p1').delete(),
    )
  })

  it('member with canManageCustomers can create customer', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertSucceeds(
      rita.collection('orgs').doc('t1').collection('customers').doc('c1').set({
        id: 'c1',
        orgId: 't1',
        userId: 'u-customer-x',
        tags: [],
        notes: null,
      }),
    )
  })

  it('customer create fails without userId FK', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertFails(
      rita.collection('orgs').doc('t1').collection('customers').doc('c1').set({
        id: 'c1',
        orgId: 't1',
        userId: '',
        tags: [],
        notes: null,
      }),
    )
  })

  it('professional cannot create customer (no canManageCustomers)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'pedro', 'professional')

    const pedro = testEnv.authenticatedContext('pedro').firestore()
    await assertFails(
      pedro.collection('orgs').doc('t1').collection('customers').doc('c1').set({
        id: 'c1',
        orgId: 't1',
        userId: 'u-x',
        tags: [],
        notes: null,
      }),
    )
  })
})

describe('services / products / subscription_plans', () => {
  it('member can read services; receptionist cannot create', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t1', 'rita', 'receptionist')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('services')
        .doc('s1')
        .set({ id: 's1', orgId: 't1', name: 'Corte', unitIds: ['u1'] })
    })

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertSucceeds(rita.collection('orgs').doc('t1').collection('services').doc('s1').get())
    await assertFails(
      rita
        .collection('orgs')
        .doc('t1')
        .collection('services')
        .doc('s2')
        .set({ name: 'X', unitIds: ['u1'] }),
    )
  })

  it('cannot create service without unitIds (or with empty list)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    const services = alice.collection('orgs').doc('t1').collection('services')

    // Missing unitIds
    await assertFails(services.doc('s1').set({ id: 's1', orgId: 't1', name: 'S1' }))
    // Empty list
    await assertFails(services.doc('s2').set({ id: 's2', orgId: 't1', name: 'S2', unitIds: [] }))
    // With ≥1 unit OK
    await assertSucceeds(
      services.doc('s3').set({ id: 's3', orgId: 't1', name: 'S3', unitIds: ['u1'] }),
    )
  })

  it('cannot create professional without serviceIds (#876 rule shape guard)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    const pros = alice.collection('orgs').doc('t1').collection('professionals')

    // Missing serviceIds — rule rejects (userId/operationalStatus present so
    // serviceIds is the only failing shape guard).
    await assertFails(
      pros.doc('p1').set({
        id: 'p1',
        orgId: 't1',
        name: 'Ana',
        userId: 'u-ana',
        unitIds: ['u1'],
        operationalStatus: 'incomplete',
      }),
    )
    // serviceIds present as empty list — rule accepts (intersection
    // invariant is server-side, not rule-enforced).
    await assertSucceeds(
      pros.doc('p2').set({
        id: 'p2',
        orgId: 't1',
        name: 'Bia',
        userId: 'u-bia',
        unitIds: ['u1'],
        serviceIds: [],
        operationalStatus: 'incomplete',
      }),
    )
  })

  it('only owner can delete a product', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t1', 'maya', 'manager')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('products')
        .doc('p1')
        .set({ id: 'p1', orgId: 't1', name: 'Pomada' })
    })

    const maya = testEnv.authenticatedContext('maya').firestore()
    await assertFails(maya.collection('orgs').doc('t1').collection('products').doc('p1').delete())

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(
      alice.collection('orgs').doc('t1').collection('products').doc('p1').delete(),
    )
  })

  it('manager can create subscription_plan; cross-org blocked', async () => {
    await seedOrg('t1', 'alice')
    await seedOrg('t2', 'eve')
    await seedMembership('t1', 'maya', 'manager')
    await seedMembership('t2', 'eve', 'owner')

    const maya = testEnv.authenticatedContext('maya').firestore()
    await assertSucceeds(
      maya
        .collection('orgs')
        .doc('t1')
        .collection('subscription_plans')
        .doc('pl1')
        .set({ id: 'pl1', orgId: 't1', name: 'Mensal' }),
    )

    // maya is not in t2 — cannot create there
    await assertFails(
      maya
        .collection('orgs')
        .doc('t2')
        .collection('subscription_plans')
        .doc('pl2')
        .set({ id: 'pl2', orgId: 't2', name: 'Mensal' }),
    )
  })
})

describe('appointments', () => {
  it('any active member can create and update appointments', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertSucceeds(
      rita.collection('orgs').doc('t1').collection('appointments').doc('a1').set({
        id: 'a1',
        orgId: 't1',
        unitId: 'u1',
        professionalId: 'p1',
        customerId: 'c1',
        serviceId: 's1',
        startAt: '2026-05-13T14:00:00.000Z',
        endAt: '2026-05-13T14:30:00.000Z',
        status: 'scheduled',
        notes: null,
        customerUserId: 'u-customer',
        professionalUserId: null,
      }),
    )

    // Update also carries the denormalized userId — the rule re-checks
    // on every write to keep the doc reachable by the CG history query.
    await assertSucceeds(
      rita
        .collection('orgs')
        .doc('t1')
        .collection('appointments')
        .doc('a1')
        .update({ status: 'completed', customerUserId: 'u-customer' }),
    )
  })

  it('appointment create fails without customerUserId (gate defends CG queries)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')

    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertFails(
      rita.collection('orgs').doc('t1').collection('appointments').doc('a1').set({
        id: 'a1',
        orgId: 't1',
        unitId: 'u1',
        professionalId: 'p1',
        customerId: 'c1',
        serviceId: 's1',
        startAt: '2026-05-13T14:00:00.000Z',
        endAt: '2026-05-13T14:30:00.000Z',
        status: 'scheduled',
        notes: null,
        customerUserId: '',
        professionalUserId: null,
      }),
    )
  })

  it('professional role can read appointments but only manager+ can delete', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'bob', 'professional')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('appointments')
        .doc('a1')
        .set({ id: 'a1', orgId: 't1' })
    })

    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertSucceeds(
      bob.collection('orgs').doc('t1').collection('appointments').doc('a1').get(),
    )
    await assertFails(
      bob.collection('orgs').doc('t1').collection('appointments').doc('a1').delete(),
    )
  })

  it('non-member cannot read or write appointments', async () => {
    await seedOrg('t1', 'alice')
    const stranger = testEnv.authenticatedContext('stranger').firestore()
    await assertFails(
      stranger.collection('orgs').doc('t1').collection('appointments').doc('a1').get(),
    )
  })
})

describe('orders', () => {
  // brief 0030, AC-02: customer is optional (anonymous standalone sale). The
  // rule admits customerId == null OR a non-empty string, never an empty string.
  function orderDoc(customerId: string | null) {
    return {
      id: 'o1',
      orgId: 't1',
      unitId: 'u1',
      customerId,
      appointmentId: null,
      status: 'open',
      items: [],
      discountCents: 0,
      notes: null,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: 0,
      totalCents: 0,
      createdAt: '2026-06-03T10:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z',
    }
  }

  it('member can create an anonymous order (customerId null — standalone sale)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')
    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertSucceeds(
      rita.collection('orgs').doc('t1').collection('orders').doc('o1').set(orderDoc(null)),
    )
  })

  it('member can create an order with a customer (appointment-born sale)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')
    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertSucceeds(
      rita.collection('orgs').doc('t1').collection('orders').doc('o1').set(orderDoc('c1')),
    )
  })

  it('order create fails with an empty-string customerId (malformed)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'rita', 'receptionist')
    const rita = testEnv.authenticatedContext('rita').firestore()
    await assertFails(
      rita.collection('orgs').doc('t1').collection('orders').doc('o1').set(orderDoc('')),
    )
  })

  it('non-member cannot create an order', async () => {
    await seedOrg('t1', 'alice')
    const stranger = testEnv.authenticatedContext('stranger').firestore()
    await assertFails(
      stranger.collection('orgs').doc('t1').collection('orders').doc('o1').set(orderDoc(null)),
    )
  })
})

// Per-org erasure markers (LGPD art. 18 "bloqueio", #1096 / brief 0032
// AC-09). Server-only on BOTH sides: written via Admin SDK in the privacy
// actions, read server-side by the resolvers (both bypass Rules). A client —
// even the blocked subject, even the org owner — can neither read nor write.
describe('blocked_subjects (server-only marker)', () => {
  it('owner cannot read the blocked_subjects collection', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('blocked_subjects')
        .doc('u-blocked')
        .set({ blockedAt: '2026-06-03T00:00:00.000Z' })
    })
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      alice.collection('orgs').doc('t1').collection('blocked_subjects').doc('u-blocked').get(),
    )
  })

  it('the blocked subject cannot read or clear their own marker', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'bob', 'professional')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('blocked_subjects')
        .doc('bob')
        .set({ blockedAt: '2026-06-03T00:00:00.000Z' })
    })
    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(
      bob.collection('orgs').doc('t1').collection('blocked_subjects').doc('bob').get(),
    )
    await assertFails(
      bob.collection('orgs').doc('t1').collection('blocked_subjects').doc('bob').delete(),
    )
  })

  it('owner cannot write a blocked_subjects marker (server-only)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      alice
        .collection('orgs')
        .doc('t1')
        .collection('blocked_subjects')
        .doc('u-x')
        .set({ blockedAt: '2026-06-03T00:00:00.000Z' }),
    )
  })
})

describe('memberships', () => {
  it('user can read their own membership', async () => {
    await seedMembership('t1', 'alice', 'owner')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(alice.collection('memberships').doc(membershipDocId('t1', 'alice')).get())
  })

  it('user cannot read someone else membership unless owner/manager', async () => {
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t1', 'bob', 'professional')

    const bob = testEnv.authenticatedContext('bob').firestore()
    await assertFails(bob.collection('memberships').doc(membershipDocId('t1', 'alice')).get())

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertSucceeds(alice.collection('memberships').doc(membershipDocId('t1', 'bob')).get())
  })

  it('client cannot write membership (role escalation prevented)', async () => {
    await seedMembership('t1', 'alice', 'professional')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(
      alice.collection('memberships').doc(membershipDocId('t1', 'alice')).update({ role: 'owner' }),
    )
  })
})

describe('cross-org isolation', () => {
  it('owner of t1 cannot read org t2 data', async () => {
    await seedOrg('t1', 'alice')
    await seedOrg('t2', 'bob')
    await seedMembership('t1', 'alice', 'owner')
    await seedMembership('t2', 'bob', 'owner')

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection('orgs')
        .doc('t2')
        .collection('customers')
        .doc('c1')
        .set({ id: 'c1', orgId: 't2', userId: 'u-bob-cust', tags: [], notes: null })
    })

    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.collection('orgs').doc('t2').collection('customers').doc('c1').get())
  })

  it('suspended membership is treated as non-member', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'alice', 'manager', 'suspended')
    const alice = testEnv.authenticatedContext('alice').firestore()
    await assertFails(alice.collection('orgs').doc('t1').get())
  })

  // Brief 0029 #1053 (AC-10): a deactivated member (`membership.status` ==
  // 'suspended') can't operate. `isMember` keys on `status == 'active'`, so the
  // suspended member loses every operational read/write — even a write it would
  // be permitted to do while active (here: a manager creating a service).
  // Reactivation (status back to 'active') restores access.
  it('suspended member loses operational access; reactivation restores it (AC-10)', async () => {
    await seedOrg('t1', 'alice')
    await seedMembership('t1', 'mgr', 'manager', 'suspended')
    const services = () =>
      testEnv
        .authenticatedContext('mgr')
        .firestore()
        .collection('orgs')
        .doc('t1')
        .collection('services')
        .doc('s1')

    // Suspended: a write the manager could otherwise do is denied.
    await assertFails(services().set({ id: 's1', orgId: 't1', name: 'S1', unitIds: ['u1'] }))

    // Reactivate (the `setMemberStatus` transition's effect on the doc) and the
    // same write now succeeds.
    await seedMembership('t1', 'mgr', 'manager', 'active')
    await assertSucceeds(services().set({ id: 's1', orgId: 't1', name: 'S1', unitIds: ['u1'] }))
  })
})
