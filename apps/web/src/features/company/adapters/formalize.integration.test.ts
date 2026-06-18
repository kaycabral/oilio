// Integration test for the `formalizeOrg` action (F3 / brief 0048) — runs
// against the Firestore emulator via the admin SDK (no Firestore mocks). Start
// the emulator with `pnpm --filter @oilio/web db:start`, or run via
// `pnpm test:integration` (boots it under `firebase emulators:exec`).
//
// What's asserted (DoD scenarios 1/2/4 + the ATIVA gate + idempotency):
//   - an informal Org → formalize with an ATIVA CNPJ → `org.formalized` emitted;
//   - replay reconstructs the company-stage Org (raiz + CompanyProfile +
//     formalizedAt) from events alone;
//   - the corporate profile lands in StoredOrg; razão social / nome fantasia
//     land in the deletable PII doc (orgs/{id}/private/taxIdentity), NOT events;
//   - the matriz Unit gains the full CNPJ-14;
//   - the ATIVA gate rejects a non-ATIVA CNPJ (no event, Org stays informal);
//   - an already-`company` Org can't be re-formalized.
//
// `getSessionUser` (auth) is mocked; every Firestore write targets the emulator.

import { Effect } from 'effect'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

let currentSession: { uid: string; email: string | null; emailVerified: boolean } | null = null
vi.mock('@/shared/firebase/admin', () => ({
  getSessionUser: () => Promise.resolve(currentSession),
}))

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}))

import type { CompanyProfile } from '@/domain'
import { StoredUnit, defaultPermissionsForRole, membershipDocId } from '@/domain'
import { OrgConfig } from '@/domain/aggregates'
import { replayAggregate } from '@/domain/effect'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { getOrg } from '@/shared/org/org'
import { formalizeOrg } from './formalize.actions'

const db = getAdminFirestore()

const CNPJ = '40148980000199'

const profile: CompanyProfile = {
  taxId: CNPJ,
  isMei: false,
  taxRegime: 'simples_nacional',
  primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
  secondaryActivities: [],
  companySize: 'micro',
  legalNature: 'Sociedade Empresária Limitada',
  registrationStatus: 'ATIVA',
  shareCapital: 1000,
  activityStartedAt: '2020-12-17',
}

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  const project = process.env.FIREBASE_ADMIN_PROJECT_ID
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

const UID = 'owner-formalize'
let orgId = ''
let unitId = ''

async function seedInformalOrg(): Promise<void> {
  const now = new Date().toISOString()
  const orgRef = db.collection('orgs').doc()
  orgId = orgRef.id
  await orgRef.set({
    id: orgId,
    name: 'Estúdio do João',
    slug: `estudio-${orgId}`.toLowerCase(),
    vertical: 'barbershop',
    fiscalProfile: { stage: 'informal' },
    ownerUserId: UID,
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: 'America/Sao_Paulo',
    slotMinutes: 15,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })

  const unitRef = orgRef.collection('units').doc()
  unitId = unitRef.id
  await unitRef.set({
    id: unitId,
    orgId,
    name: 'Matriz',
    slug: 'matriz',
    address: null,
    businessHours: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })

  const mId = membershipDocId(orgId, UID)
  await db
    .collection('memberships')
    .doc(mId)
    .set({
      id: mId,
      orgId,
      userId: UID,
      role: 'owner',
      status: 'active',
      invitedBy: null,
      joinedAt: now,
      updatedAt: now,
      unitId: null,
      permissions: defaultPermissionsForRole('owner'),
      commissionRate: null,
    })

  await db.collection('users').doc(UID).set({
    uid: UID,
    email: 'joao@example.com',
    displayName: 'João',
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: orgId,
    whatsapp: '5511999990000',
    birthDate: '1990-03-10',
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: true,
    claimedAt: now,
    termsAcceptedAt: now,
    termsVersion: '1',
    privacyAcceptedAt: now,
    privacyVersion: '1',
    anonymizedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

function formFor(overrides: Partial<CompanyProfile> = {}, legalName = 'CABRAL TECNOLOGIA LTDA') {
  const merged = { ...profile, ...overrides }
  const fd = new FormData()
  fd.set('taxId', '40.148.980/0001-99')
  fd.set('profile', JSON.stringify(merged))
  fd.set('legalName', legalName)
  fd.set('tradeName', 'CABRAL TECH')
  return fd
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST not set — run via `pnpm test:integration`.')
  }
})

beforeEach(async () => {
  await clearFirestore()
  currentSession = { uid: UID, email: 'joao@example.com', emailVerified: true }
  await seedInformalOrg()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('formalizeOrg (brief 0048 — emulator)', () => {
  it('informal → ATIVA CNPJ → org.formalized → company stage, profile in Stored, PII in doc, matriz CNPJ-14', async () => {
    const res = await formalizeOrg(formFor())
    expect(res).toEqual({ ok: true })

    // Replay reconstructs the company-stage Org from events alone (scenario 4).
    const replayed = await Effect.runPromise(
      replayAggregate(OrgConfig, `orgs/${orgId}`).pipe(Effect.provide(FirestoreLayerLive)),
    )
    expect(replayed.fiscalProfile.stage).toBe('company')
    if (replayed.fiscalProfile.stage !== 'company') throw new Error('expected company')
    expect(replayed.fiscalProfile.taxId).toBe(CNPJ)
    expect(replayed.fiscalProfile.companyProfile.taxRegime).toBe('simples_nacional')
    expect(replayed.fiscalProfile.formalizedAt).toBeTruthy()

    // The read path (StoredOrg profile + merged PII doc) reflects the company
    // stage: CompanyProfile (non-PII) in Stored, razão social / fantasia merged
    // from the deletable PII doc.
    const org = await getOrg(orgId)
    expect(org?.fiscalProfile.stage).toBe('company')
    if (org?.fiscalProfile.stage !== 'company') throw new Error('expected company')
    expect(org.fiscalProfile.companyProfile.taxId).toBe(CNPJ)
    expect(org.taxIdentity?.kind).toBe('company')
    if (org.taxIdentity?.kind !== 'company') throw new Error('expected company taxIdentity')
    expect(org.taxIdentity.legalName).toBe('CABRAL TECNOLOGIA LTDA')
    expect(org.taxIdentity.tradeName).toBe('CABRAL TECH')

    // The event carries NO razão social / nome fantasia (ADR 0010).
    const eventDoc = (
      await db.collection('orgs').doc(orgId).collection('events').doc('v000002').get()
    ).data()
    expect(eventDoc?._tag).toBe('org.formalized')
    expect(JSON.stringify(eventDoc)).not.toMatch(/CABRAL TECNOLOGIA LTDA|CABRAL TECH/)

    // The informal matriz becomes matriz 0001 — gains the full CNPJ-14.
    const unitSnap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('units')
      .doc(unitId)
      .withConverter(fsConverter(StoredUnit))
      .get()
    expect(unitSnap.data()?.taxId).toBe(CNPJ)
  })

  it('ATIVA gate: a non-ATIVA CNPJ is rejected and the Org stays informal', async () => {
    const res = await formalizeOrg(formFor({ registrationStatus: 'BAIXADA' }))
    expect(res.ok).toBe(false)

    const org = await getOrg(orgId)
    expect(org?.fiscalProfile.stage).toBe('informal')
    // No org.formalized event was appended (still at v1 from the seed).
    const v2 = await db.collection('orgs').doc(orgId).collection('events').doc('v000002').get()
    expect(v2.exists).toBe(false)
  })

  it('idempotency: an already-formalized Org cannot be re-formalized', async () => {
    const first = await formalizeOrg(formFor())
    expect(first.ok).toBe(true)

    const second = await formalizeOrg(formFor())
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected rejection')
    expect(second.error).toMatch(/já está formalizada/)
  })
})
