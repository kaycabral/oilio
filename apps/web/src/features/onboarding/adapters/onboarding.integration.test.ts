// Integration test for the `createOrg` saga (F2 / brief 0046) — runs against
// the Firestore emulator via the admin SDK (no mocks of Firestore). Start the
// emulator with `pnpm --filter @oilio/web db:start`, or run via
// `pnpm test:integration` (boots it under `firebase emulators:exec`).
//
// What's asserted (PRD Identidade v2 / brief 0046 — NO auto-matriz):
//   - account-first signup atomically produces Org + owner Membership and NO
//     unit (the "Negócio sem unidade" empty-state is intentional);
//   - replay reconstructs the Org from events alone;
//   - a forced failure at the membership step compensates — no partial state.
//
// `getSessionUser` (auth) and `next/navigation` redirect are mocked: the action
// targets the emulator for every write, but session minting + the success
// `redirect()` are environment concerns, not the saga under test. `emitEvent`
// is partially spied so the failure case can force the membership step to fail
// without touching the real org/unit emissions.

import { Effect } from 'effect'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

// Mutable session for the action's `getSessionUser()` call.
let currentSession: { uid: string; email: string | null; emailVerified: boolean } | null = null
vi.mock('@/shared/firebase/admin', () => ({
  getSessionUser: () => Promise.resolve(currentSession),
}))

// `redirect('/')` throws Next's internal NEXT_REDIRECT marker in real Next. In
// the test env we throw a sentinel so the happy path can `await` createOrg and
// then assert the persisted state.
const REDIRECT = new Error('NEXT_REDIRECT')
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw REDIRECT
  },
}))

// Partial spy over the effect-bridge: real emissions by default, but when
// `failMembershipCreate` is on, `membership.created` returns a failure so we can
// exercise the compensation path deterministically.
let failMembershipCreate = false
vi.mock('@/shared/effect-bridge', async (importOriginal) => {
  const actual = await importOriginal<{ emitEvent: EmitEvent }>()
  const realEmit = actual.emitEvent
  const emitEvent: EmitEvent = (config, path, input) => {
    if (failMembershipCreate && input._tag === 'membership.created') {
      return Promise.resolve({ ok: false as const, error: 'forced failure' })
    }
    return realEmit(config, path, input)
  }
  return { ...actual, emitEvent }
})

import { membershipDocId } from '@/domain'
import { OrgConfig } from '@/domain/aggregates'
import { replayAggregate } from '@/domain/effect'
import { getAdminFirestore } from '@/shared/db'
import { FirestoreLayerLive } from '@/shared/db/effect'
// Imported only to derive the spy's type via `typeof` (type position — the
// runtime binding is irrelevant, and is itself the mocked one anyway).
import type { emitEvent as emitEventRef } from '@/shared/effect-bridge'
import { createOrg } from './onboarding.actions'

type EmitEvent = typeof emitEventRef

const db = getAdminFirestore()

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  const project = process.env.FIREBASE_ADMIN_PROJECT_ID
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

// Seed a completed owner User (whatsapp set) — the state the profile-completion
// gate guarantees before the org-creation route is reachable.
async function seedOwner(uid: string, whatsapp: string, email: string | null): Promise<void> {
  const now = new Date().toISOString()
  await db.collection('users').doc(uid).set({
    uid,
    email,
    displayName: 'Owner Smoke',
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: null,
    whatsapp,
    birthDate: '1990-01-01',
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: true,
    claimedAt: now,
    anonymizedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: now,
    updatedAt: now,
  })
}

function orgForm(name: string): FormData {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('vertical', 'barbershop')
  return fd
}

async function findOnlyOrgId(ownerUserId: string): Promise<string> {
  const snap = await db.collection('orgs').where('ownerUserId', '==', ownerUserId).get()
  expect(snap.docs).toHaveLength(1)
  return snap.docs[0]!.id
}

beforeAll(async () => {
  await clearFirestore()
})

beforeEach(() => {
  failMembershipCreate = false
  currentSession = null
})

afterEach(async () => {
  await clearFirestore()
})

describe('createOrg — account-first signup (F2 / brief 0046)', () => {
  it('atomically creates the Org and the owner Membership, with NO unit', async () => {
    const uid = 'owner-happy'
    await seedOwner(uid, '5511988887777', 'owner@example.com')
    currentSession = { uid, email: 'owner@example.com', emailVerified: true }

    // createOrg ends in redirect('/') → our sentinel.
    await expect(createOrg(orgForm('Barbearia do João'))).rejects.toBe(REDIRECT)

    const orgId = await findOnlyOrgId(uid)

    // Org projection exists with the name.
    const orgDoc = await db.collection('orgs').doc(orgId).get()
    expect(orgDoc.exists).toBe(true)
    expect(orgDoc.data()?.['name']).toBe('Barbearia do João')

    // NO auto-matriz: the Org is born with no unit — the intentional empty-state
    // (PRD Identidade v2 / brief 0046 AC-02). The guided-first-unit flow creates
    // the establishment later.
    const unitsSnap = await db.collection('orgs').doc(orgId).collection('units').get()
    expect(unitsSnap.docs).toHaveLength(0)

    // Owner Membership is org-scoped (unitId: null) and active.
    const membership = await db.collection('memberships').doc(membershipDocId(orgId, uid)).get()
    expect(membership.exists).toBe(true)
    expect(membership.data()?.['role']).toBe('owner')
    expect(membership.data()?.['unitId']).toBeNull()

    // currentOrgId points at the new org.
    const userDoc = await db.collection('users').doc(uid).get()
    expect(userDoc.data()?.['currentOrgId']).toBe(orgId)
  })

  it('replay reconstructs the Org from events', async () => {
    const uid = 'owner-replay'
    await seedOwner(uid, '5511977776666', 'replay@example.com')
    currentSession = { uid, email: 'replay@example.com', emailVerified: true }

    await expect(createOrg(orgForm('Estúdio Replay'))).rejects.toBe(REDIRECT)
    const orgId = await findOnlyOrgId(uid)

    const replayOrg = await Effect.runPromise(
      replayAggregate(OrgConfig, `orgs/${orgId}`).pipe(Effect.provide(FirestoreLayerLive)),
    )
    expect(replayOrg).not.toBeNull()
    expect(replayOrg?.['name']).toBe('Estúdio Replay')
  })

  it('compensates with no partial state when the membership step fails', async () => {
    const uid = 'owner-fail'
    await seedOwner(uid, '5511966665555', 'fail@example.com')
    currentSession = { uid, email: 'fail@example.com', emailVerified: true }
    failMembershipCreate = true

    const result = await createOrg(orgForm('Empresa Falha'))
    expect(result).toEqual({
      ok: false,
      error: 'Não foi possível concluir a criação da conta. Tente de novo.',
    })

    // No org, no unit, no membership, no PII, and currentOrgId untouched.
    const orgs = await db.collection('orgs').where('ownerUserId', '==', uid).get()
    expect(orgs.empty).toBe(true)

    const memberships = await db.collection('memberships').where('userId', '==', uid).get()
    expect(memberships.empty).toBe(true)

    const userDoc = await db.collection('users').doc(uid).get()
    expect(userDoc.data()?.['currentOrgId']).toBeNull()
  })
})
