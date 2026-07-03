// Single-source helper that creates (or finds) the User + Customer pair
// behind a customer record. Used by every customer-creation path:
//
//   - features/onboarding (self-signup completion — #1278)
//   - features/agenda/adapters/agenda.actions.ts (quick-add from booking dialog)
//   - features/self-book (per-unit public booking confirm)
//
// Schema decided in #832 + #836: PII (name, mobile, email, birthDate)
// lives on the global `users/{userId}` doc; per-org `customers/{id}`
// only carries operational data (computed scores) + the
// userId FK. See https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Identidade
//
// NO dedupe by mobile (brief 0077, #1276). The mobile is now GLOBALLY unique at
// the database level (`users_mobile_unique`), so the front-desk quick-add never
// folds a typed number into an existing User — folding-by-mobile was the SOURCE
// of the wrong-number breach the brief kills (a mistyped number silently
// capturing a real login). The quick-add creates a brand-new stub User; if the
// number already has an owner the DB refuses the insert (23505) and we surface a
// handled error pointing the operator at the invite flow (no OTP yet to verify
// ownership). A Customer doc is created per-org; if one already exists for the
// same userId in this org we return it instead of inserting a duplicate.
//
// Identity (`users`) is a global CRUD record written directly (upsert/patch);
// the per-org customer shadow is event-sourced (the projection writes the doc).
// Public booking is the only un-authenticated caller and is OK on the server
// path because the action receives no auth surface beyond the form data.

import { normalizeBrazilPhone, type Attribution, type StoredCustomer, type User } from '@/domain'
import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/unique-violation'
import { putUser } from '@/shared/db/pg/users-store'
import { emitEvent } from '@/shared/effect-bridge'
import { linkCustomerOrg } from '@/shared/identity/org-links'
import { randomUUID } from 'node:crypto'

// Shown when a quick-add types a WhatsApp that already backs another User. The
// front desk can't claim someone else's number (one owner per number, no OTP to
// verify) — it must hand out an invite instead.
const WHATSAPP_IN_USE_ERROR =
  'Esse número de WhatsApp já pertence a outro cliente. Envie um convite para que a pessoa faça o próprio cadastro.'

// What we actually persist under `orgs/{t}/customers/{id}`. The PII
// fields on the public `Customer` type are merged in at read time — see
// `customer-read.ts`. Re-exported from `@/domain` (the read-model
// source-of-truth) so other persistence-layer writers (e.g. the dev seed in
// `scripts/seed.ts`) reuse this exact shape from here without re-deriving it.
export type { StoredCustomer } from '@/domain'

export type UpsertCustomerInput = {
  orgId: string
  name: string
  mobileRaw: string
  email: string | null
  birthDate: string | null
  // Write-once acquisition attribution (brief 0077 AC-10/AC-11) captured when the
  // Customer is first materialized. Omitted/null on legacy callers.
  acquisition?: Attribution | null
}

export type UpsertCustomerResult =
  | { ok: true; customerId: string; userId: string }
  | { ok: false; error: string }

// Stub User created by a front-desk quick-add (no Firebase Auth UID — a random
// UUID doubles as both doc id and `uid`). It carries the typed mobile, which
// the global `users_mobile_unique` index keeps singular: if the number already
// has an owner the insert is refused (no silent fold — brief 0077, #1276).
function buildUserStub(
  userId: string,
  input: UpsertCustomerInput,
  mobile: string,
  now: string,
): User {
  return {
    uid: userId,
    email: input.email,
    displayName: input.name,
    avatarUrl: null,
    emailVerified: false,
    currentOrgId: null,
    mobile,
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

// Resolve the existing customer shadow for `userId` in `orgId` (the first match
// — at most one is created per pair), reading its id under RLS. Returns null
// when the subject has no shadow in this org yet.
async function findCustomerIdByUserId(orgId: string, userId: string): Promise<string | null> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM customers WHERE org_id = $1 AND user_id = $2 LIMIT 1', [orgId, userId])
      .then((res) => res.rows),
  )
  return rows[0]?.id ?? null
}

export async function upsertCustomerWithUser(
  input: UpsertCustomerInput,
): Promise<UpsertCustomerResult> {
  const mobile = normalizeBrazilPhone(input.mobileRaw)
  if (!mobile) return { ok: false, error: 'WhatsApp inválido' }

  const now = new Date().toISOString()

  // Create a fresh stub User for the typed contact. No find-by-mobile fold:
  // the DB's global uniqueness refuses a number that already has an owner, which
  // we translate into a handled error pointing at the invite flow.
  const userId = randomUUID()
  try {
    await putUser(buildUserStub(userId, input, mobile, now))
  } catch (err) {
    if (isUniqueViolation(err, USERS_MOBILE_UNIQUE)) {
      return { ok: false, error: WHATSAPP_IN_USE_ERROR }
    }
    throw err
  }

  // Resolve Customer in this org. Re-booking reuses the shadow: no
  // operator-editable fields remain on it.
  const existingId = await findCustomerIdByUserId(input.orgId, userId)
  if (existingId) {
    return { ok: true, customerId: existingId, userId }
  }

  const customerId = randomUUID()
  const customer: StoredCustomer = {
    id: customerId,
    orgId: input.orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: input.acquisition ?? null,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: the projection writes the Customer doc (no parallel direct write).
  const created = await emitEvent(
    CustomerConfig,
    aggregateRef(CustomerConfig, input.orgId, customerId),
    {
      _tag: 'customer.created',
      actorId: userId,
      payload: { data: customer },
    },
  )
  if (!created.ok) return { ok: false, error: created.error }
  // Saga step (brief 0032 / #1097, AC-10): identity-layer reverse index so the
  // subject can later discover this establishment without a cross-org query.
  await linkCustomerOrg(userId, input.orgId)

  return { ok: true, customerId, userId }
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
  acquisition: Attribution | null = null,
): Promise<{ customerId: string; created: boolean }> {
  const existingId = await findCustomerIdByUserId(orgId, userId)
  if (existingId) {
    return { customerId: existingId, created: false }
  }
  const customerId = randomUUID()
  const now = new Date().toISOString()
  const customer: StoredCustomer = {
    id: customerId,
    orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    // Write-once acquisition (brief 0077 AC-11): the first touch that created
    // this org relationship. Null when the signup carried no attribution.
    acquisition,
    createdAt: now,
    updatedAt: now,
  }
  const ev = await emitEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, customerId), {
    _tag: 'customer.created',
    actorId: userId,
    payload: { data: customer },
  })
  if (!ev.ok) throw new Error(ev.error)
  // Saga step (brief 0032 / #1097, AC-10): record the identity-layer reverse
  // index for the self-signup customer relationship. References only, zero PII.
  await linkCustomerOrg(userId, orgId)
  return { customerId, created: true }
}

// NOTE(#1279): `updateCustomerPii` was removed. The establishment no longer
// edits a customer's PII — the customer owns their own data (#1278, #832) and
// the establishment-facing surface is read-only. The account identity (incl.
// `email`) is written only by the customer's own self-signup/completion path
// (`upsertCustomerWithUser` above), never typed by the recepção.
