// Integration test for the `formalizeUnit` action (brief 0048 / PRD Identidade
// v2) — runs against the Firestore emulator via the admin SDK (no Firestore
// mocks). Start the emulator with `pnpm --filter @oilio/web db:start`, or run
// via `pnpm test:integration` (boots it under `firebase emulators:exec`).
//
// What's asserted (DoD scenarios 1/2/4 + the ATIVA gate + idempotency):
//   - an informal Unit → formalize with an ATIVA CNPJ → `unit.formalized`
//     emitted;
//   - replay reconstructs the company-stage Unit (CNPJ-14 + CompanyProfile +
//     formalizedAt) from events alone;
//   - the corporate profile lands in StoredUnit; razão social / nome fantasia
//     land in the deletable per-unit PII doc
//     (orgs/{orgId}/units/{unitId}/private/taxIdentity), NOT events;
//   - matriz/filial/raiz are derivable from the CNPJ-14;
//   - the ATIVA gate rejects a non-ATIVA CNPJ (no event, Unit stays informal);
//   - an already-`company` Unit can't be re-formalized.
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
import { cnpjRaiz, defaultPermissionsForRole, isMatrizCnpj, membershipDocId } from '@/domain'
import { UnitConfig } from '@/domain/aggregates'
import { replayAggregate } from '@/domain/effect'
import { getAdminFirestore } from '@/shared/db'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { getUnitById, getUnitTaxIdentity } from '@/shared/org/unit-read'
import { formalizeUnit } from './formalize.actions'

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
    name: 'Centro',
    slug: 'centro',
    address: {
      postalCode: '01310-100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Av. Paulista',
      number: '1000',
      complement: null,
    },
    timezone: 'America/Sao_Paulo',
    // v2 unit shape (PRD Identidade § Contrato de tipagem): the flat
    // `hoursMode` + `businessHours` were replaced by the `agenda` union.
    agenda: {
      mode: 'fixed',
      businessHours: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: null,
        sunday: null,
      },
    },
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  // PII sidecar (whatsapp/email) so getUnitById hydrates a real Unit.
  await unitRef.parent
    .parent!.collection('units_pii')
    .doc(unitId)
    .set({ whatsapp: '5511999990000', email: null })

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
  fd.set('unitId', unitId)
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

describe('formalizeUnit (brief 0048 — emulator)', () => {
  it('informal → ATIVA CNPJ → unit.formalized → company, profile in Stored, PII in doc, raiz derivable', async () => {
    const res = await formalizeUnit(formFor())
    expect(res).toEqual({ ok: true })

    // Replay reconstructs the company-stage Unit from events alone (scenario 4).
    const replayed = await Effect.runPromise(
      replayAggregate(UnitConfig, `orgs/${orgId}/units/${unitId}`).pipe(
        Effect.provide(FirestoreLayerLive),
      ),
    )
    expect(replayed.fiscal.kind).toBe('company')
    if (replayed.fiscal.kind !== 'company') throw new Error('expected company')
    expect(replayed.fiscal.taxId).toBe(CNPJ)
    expect(replayed.fiscal.companyProfile.taxRegime).toBe('simples_nacional')
    expect(replayed.fiscal.formalizedAt).toBeTruthy()
    // Matriz/raiz are derivable from the CNPJ-14 (never stored).
    expect(isMatrizCnpj(replayed.fiscal.taxId)).toBe(true)
    expect(cnpjRaiz(replayed.fiscal.taxId)).toBe('40148980')

    // The read path (StoredUnit fiscal + merged PII doc) reflects the company
    // stage: CompanyProfile (non-PII) in Stored, razão social / fantasia in the
    // deletable per-unit PII doc.
    const unit = await getUnitById(orgId, unitId)
    expect(unit?.fiscal.kind).toBe('company')
    if (unit?.fiscal.kind !== 'company') throw new Error('expected company fiscal')
    expect(unit.fiscal.companyProfile.taxId).toBe(CNPJ)
    const taxIdentity = await getUnitTaxIdentity(orgId, unitId)
    expect(taxIdentity?.kind).toBe('company')
    if (taxIdentity?.kind !== 'company') throw new Error('expected company taxIdentity')
    expect(taxIdentity.legalName).toBe('CABRAL TECNOLOGIA LTDA')
    expect(taxIdentity.tradeName).toBe('CABRAL TECH')

    // The event carries NO razão social / nome fantasia (ADR 0010).
    const eventDoc = (
      await db
        .collection('orgs')
        .doc(orgId)
        .collection('units')
        .doc(unitId)
        .collection('events')
        .doc('v000002')
        .get()
    ).data()
    expect(eventDoc?._tag).toBe('unit.formalized')
    expect(JSON.stringify(eventDoc)).not.toMatch(/CABRAL TECNOLOGIA LTDA|CABRAL TECH/)
  })

  it('ATIVA gate: a non-ATIVA CNPJ is rejected and the Unit stays informal', async () => {
    const res = await formalizeUnit(formFor({ registrationStatus: 'BAIXADA' }))
    expect(res.ok).toBe(false)

    const unit = await getUnitById(orgId, unitId)
    expect(unit?.fiscal.kind).toBe('informal')
    // No unit.formalized event was appended (still at v1 from the seed).
    const v2 = await db
      .collection('orgs')
      .doc(orgId)
      .collection('units')
      .doc(unitId)
      .collection('events')
      .doc('v000002')
      .get()
    expect(v2.exists).toBe(false)
  })

  it('idempotency: an already-formalized Unit cannot be re-formalized', async () => {
    const first = await formalizeUnit(formFor())
    expect(first.ok).toBe(true)

    const second = await formalizeUnit(formFor())
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected rejection')
    expect(second.error).toMatch(/já está formalizada/)
  })
})
