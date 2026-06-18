// Single-source helper that creates (or finds) the User + Customer pair
// behind a customer record. Used by every customer-creation path in V0:
//
//   - /(app)/customers/actions.ts (recepcionista form)
//   - features/agenda/adapters/agenda.actions.ts (quick-add from booking dialog)
//   - /(public)/[slug]/book/actions.ts (public landing booking)
//
// Schema decided in #832 + #836: PII (name, whatsapp, email, birthDate)
// lives on the global `users/{userId}` doc; per-org `customers/{id}`
// only carries operational data (computed scores) + the
// userId FK. See https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Identidade
//
// Idempotency: dedupe by whatsapp at the User level (a single User backs
// the same WhatsApp across every org). A Customer doc is created
// per-org; if one already exists for the same userId in this org we
// patch its operational fields instead of inserting a duplicate.
//
// All Firestore writes go through the admin SDK (rules bypassed). Public
// booking is the only un-authenticated caller and is OK on the admin path
// because the action receives no auth surface beyond the form data.

import { normalizeBrazilPhone, StoredCustomer, User } from '@/domain'
import { CustomerConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { linkCustomerOrg } from '@/shared/identity/org-links'
import { randomUUID } from 'node:crypto'

// What we actually persist under `orgs/{t}/customers/{id}`. The PII
// fields on the public `Customer` type are merged in at read time — see
// `customer-read.ts`. Re-exported from `@/domain` (the read-model
// source-of-truth) so other persistence-layer writers (e.g. the dev seed in
// `scripts/seed.ts`) reuse this exact shape from here without re-deriving it.
export type { StoredCustomer } from '@/domain'

export type UpsertCustomerInput = {
  orgId: string
  name: string
  whatsappRaw: string
  email: string | null
  birthDate: string | null
}

export type UpsertCustomerResult =
  | { ok: true; customerId: string; userId: string }
  | { ok: false; error: string }

// Stub User created when no record matches the WhatsApp (no Firebase Auth UID —
// random UUID doubles as both doc id and `uid`). When the same human signs up
// via OAuth later, #839 dedupe by whatsapp reconciles the records.
function buildUserStub(
  userId: string,
  input: UpsertCustomerInput,
  whatsapp: string,
  now: string,
): User {
  return {
    uid: userId,
    email: input.email,
    displayName: input.name,
    avatarUrl: null,
    emailVerified: false,
    currentOrgId: null,
    whatsapp,
    birthDate: input.birthDate,
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: false,
    claimedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    anonymizedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

// Non-destructive PII fill — only on stubs. Once a user claims the doc via OAuth
// (`claimedAt != null`), the org can't write to the User anymore (data
// ownership — #832 / #839); the typed-in PII is silently ignored.
async function fillStubPii(
  ref: FirebaseFirestore.DocumentReference,
  existing: User,
  input: UpsertCustomerInput,
  now: string,
): Promise<void> {
  if (existing.claimedAt !== null) return
  const patch: Record<string, unknown> = {}
  if (!existing.displayName && input.name) patch.displayName = input.name
  if (!existing.email && input.email) patch.email = input.email
  if (!existing.birthDate && input.birthDate) patch.birthDate = input.birthDate
  if (Object.keys(patch).length === 0) return
  patch.updatedAt = now
  await ref.update(patch)
}

// Resolve User by whatsapp (PII canonical channel). A match wins regardless of
// which org first saw the User — the "global User" principle. Returns the
// userId, creating a stub or filling a matched stub's PII as needed.
async function resolveUserId(
  db: ReturnType<typeof getAdminFirestore>,
  input: UpsertCustomerInput,
  whatsapp: string,
  now: string,
): Promise<string> {
  const matches = await db
    .collection('users')
    .withConverter(fsConverter(User))
    .where('whatsapp', '==', whatsapp)
    .limit(1)
    .get()
  if (matches.empty) {
    const userId = randomUUID()
    await db
      .collection('users')
      .doc(userId)
      .set(buildUserStub(userId, input, whatsapp, now))
    return userId
  }
  const doc = matches.docs[0]!
  const existing = doc.data()
  if (existing) await fillStubPii(doc.ref, existing, input, now)
  return doc.id
}

export async function upsertCustomerWithUser(
  input: UpsertCustomerInput,
): Promise<UpsertCustomerResult> {
  const whatsapp = normalizeBrazilPhone(input.whatsappRaw)
  if (!whatsapp) return { ok: false, error: 'WhatsApp inválido' }

  const db = getAdminFirestore()
  const now = new Date().toISOString()

  const userId = await resolveUserId(db, input, whatsapp, now)

  // Resolve Customer in this org. Re-booking reuses the shadow: no
  // operator-editable fields remain on it.
  const orgCustomers = db.collection('orgs').doc(input.orgId).collection('customers')
  const existing = await orgCustomers.where('userId', '==', userId).limit(1).get()
  if (!existing.empty) {
    return { ok: true, customerId: existing.docs[0]!.id, userId }
  }

  const ref = orgCustomers.doc()
  const customer: StoredCustomer = {
    id: ref.id,
    orgId: input.orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: the projection writes the Customer doc (no parallel `ref.set`).
  const created = await emitEvent(CustomerConfig, `orgs/${input.orgId}/customers/${ref.id}`, {
    _tag: 'customer.created',
    actorId: userId,
    payload: { data: customer },
  })
  if (!created.ok) return { ok: false, error: created.error }
  // Saga step (brief 0032 / #1097, AC-10): identity-layer reverse index so the
  // subject can later discover this establishment without a cross-org query.
  await linkCustomerOrg(userId, input.orgId)

  return { ok: true, customerId: ref.id, userId }
}

// Idempotently materializes a Customer doc in `orgId` for an already
// existing `userId`. Used by the self-signup flow (#840) — the User doc
// was created by the OAuth session route, PII was captured by the
// completion step, so we only need the per-org operational shadow.
//
// Idempotent on re-entry: a returning customer hitting `/{slug}/signup/done`
// gets their existing Customer id back, untouched.
export async function ensureSelfSignupCustomer(
  orgId: string,
  userId: string,
): Promise<{ customerId: string; created: boolean }> {
  const db = getAdminFirestore()
  const orgCustomers = db.collection('orgs').doc(orgId).collection('customers')
  const existing = await orgCustomers.where('userId', '==', userId).limit(1).get()
  if (!existing.empty) {
    return { customerId: existing.docs[0]!.id, created: false }
  }
  const ref = orgCustomers.doc()
  const now = new Date().toISOString()
  const customer: StoredCustomer = {
    id: ref.id,
    orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const ev = await emitEvent(CustomerConfig, `orgs/${orgId}/customers/${ref.id}`, {
    _tag: 'customer.created',
    actorId: userId,
    payload: { data: customer },
  })
  if (!ev.ok) throw new Error(ev.error)
  // Saga step (brief 0032 / #1097, AC-10): record the identity-layer reverse
  // index for the self-signup customer relationship. References only, zero PII.
  await linkCustomerOrg(userId, orgId)
  return { customerId: ref.id, created: true }
}

// Update PII on the User behind a Customer. Recepcionista is allowed to do
// this only while the User is still a stub (`claimedAt === null`). Once the
// user claims the account via OAuth, only they may edit their own PII —
// this helper enforces that as a hard gate (data ownership, #832).
export async function updateCustomerPii(
  customerId: string,
  orgId: string,
  patch: {
    name?: string
    whatsappRaw?: string
    email?: string | null
    birthDate?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getAdminFirestore()
  const customerSnap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('customers')
    .doc(customerId)
    .withConverter(fsConverter(StoredCustomer))
    .get()
  const customer = customerSnap.data()
  if (!customer) return { ok: false, error: 'Customer não encontrado' }
  const userId = customer.userId

  const userRef = db.collection('users').doc(userId)
  const userSnap = await userRef.withConverter(fsConverter(User)).get()
  const user = userSnap.data()
  if (!user) return { ok: false, error: 'User órfão — Customer aponta pra nada' }
  if (user.claimedAt !== null) {
    return {
      ok: false,
      error: 'Cliente já se cadastrou — apenas ele pode atualizar os próprios dados',
    }
  }

  const userPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) userPatch.displayName = patch.name
  if (patch.email !== undefined) userPatch.email = patch.email
  if (patch.birthDate !== undefined) userPatch.birthDate = patch.birthDate
  if (patch.whatsappRaw !== undefined) {
    const normalized = normalizeBrazilPhone(patch.whatsappRaw)
    if (!normalized) return { ok: false, error: 'WhatsApp inválido' }
    userPatch.whatsapp = normalized
  }
  if (Object.keys(userPatch).length === 0) return { ok: true }
  userPatch.updatedAt = new Date().toISOString()
  await userRef.update(userPatch)
  return { ok: true }
}
