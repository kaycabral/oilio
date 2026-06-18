// Test helpers for E2E specs that need an authenticated session against the
// Firebase emulator. Each helper is a thin wrapper over the auth/firestore
// REST APIs so we don't import firebase-admin into Playwright workers (which
// would slow boot and add a hard env coupling).
//
// Pre-reqs (see `playwright.config.ts` webServer.env):
// - Firebase emulators (auth on 9099, firestore on 8080) running.
// - Dev server with `FIREBASE_AUTH_EMULATOR_HOST` + `FIRESTORE_EMULATOR_HOST`
//   so its admin SDK routes to the emulator.

import { expect, type BrowserContext, type Page } from '@playwright/test'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { execFileSync } from 'node:child_process'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from './emulator'

const API_KEY = 'fake-api-key'

// Admin SDK pointed at the emulator. Used for the email-verified flip
// (the REST `accounts:update` returns 200 but doesn't actually persist the
// field in the auth emulator — flagged via signInWithPassword returning
// email_verified=false in subsequent tokens). The admin path works.
// The emulator host env is injected by `firebase emulators:exec`; the SDK
// reads FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST directly.
let cachedAdminApp: App | undefined
function adminApp(): App {
  if (cachedAdminApp) return cachedAdminApp
  const existing = getApps()[0]
  cachedAdminApp = existing ?? initializeApp({ projectId: PROJECT_ID })
  return cachedAdminApp
}

export type SeedOrgInput = {
  // Mirrors the `SlotMinutes` read-model literal (5|10|15|30) — the value lands
  // on `StoredOrg.slotMinutes`, so the union must match the schema.
  slotMinutes?: 5 | 10 | 15 | 30
  hasBusinessHours?: boolean
  unitCount?: number
  professionalCount?: number
  professionalOperationalStatus?: 'incomplete' | 'operational'
  // Self-booking publication gate (#988) — controls public page visibility.
  // Default true matches the 99% case where specs target an already-published
  // org; pass `false` to seed an unpublished one (public page 404s).
  selfBookingPublished?: boolean
  vertical?: 'barbershop' | 'auto_wash' | 'auto_detailing' | 'other'
  cancellationPolicy?: { enabled: boolean; minNoticeMinutes: number }
}

export type SeededOrg = {
  uid: string
  email: string
  password: string
  orgId: string
  unitIds: string[]
  professionalIds: string[]
}

// Curl-based wrappers — Node's global fetch occasionally exhibits an undici
// HeadersTimeout when firebase-admin and fetch share the event loop. Curl
// spawns fresh connections.
function curlJson<T>(url: string, body: unknown, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    ['-fsS', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)],
    { encoding: 'utf8' },
  )
  return parseJson(out, decode)
}

function curlSetCookie(url: string, body: unknown): string {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-i',
      '-X',
      'POST',
      url,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
    ],
    { encoding: 'utf8' },
  )
  const m = out.match(/set-cookie:[^\n]*__session=([^;\r\n]+)/i)
  if (!m) throw new Error('No __session cookie in response:\n' + out)
  return m[1]!
}

function fsBaseUrl() {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function curlPut(url: string, body: unknown): FsDocument {
  // `Authorization: Bearer owner` is the Firestore emulator's escape hatch
  // for admin-equivalent writes — bypasses the Firestore Rules (which would
  // 403 our seed PATCH for an unauthenticated REST caller).
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
    ],
    { encoding: 'utf8' },
  )
  return parseJson(out, decodeFsDocument)
}

// ── Type-driven Firestore writes ──────────────────────────────────────────────
//
// Fixture docs are built as TYPED object literals annotated with the read-model
// type the READ boundary decodes that collection with (`Stored*` for the
// PII-omitting projections). A missing/renamed field then fails `tsc` — the
// fixtures consume `@/domain` as the single source of truth, so schema drift is
// a compile-time error instead of a silent incomplete doc that the validated
// reads (`fsConverter`/`Schema.decodeUnknownSync`) reject at runtime.
//
// The typed object is serialized to the Firestore REST wire shape by the
// generic `toFsFields` encoder below and written through the existing
// synchronous `curlPut` (admin-equivalent `Authorization: Bearer owner`). The
// type annotation on each object literal — NOT the transport — is what catches
// drift, so the seeds stay synchronous and the ~250 spec call-sites (which do
// not `await` the id-returning seeds) keep working unchanged.

import {
  defaultPermissionsForRole,
  EMPTY_ADDRESS,
  EMPTY_BUSINESS_HOURS,
  goalDocId,
  membershipDocId,
  type AgendaBlock,
  type AllowedTimeScope,
  type Appointment,
  type BookingLimits,
  type CatalogItem,
  type CatalogProductItem,
  type CatalogServiceItem,
  type Category,
  type Charge,
  type Commission,
  type Goal,
  type InvitePii,
  type Membership,
  type MembershipPermissions,
  type Order,
  type OrderCoverage,
  type OrderItem,
  type OrgLink,
  type Product,
  type ProfessionalPii,
  type Role,
  type Service,
  type StoredCustomer,
  type StoredInvite,
  type StoredOrg,
  type StoredProfessional,
  type StoredUnit,
  type Subscription,
  type SubscriptionPeriod,
  type SubscriptionPlan,
  type SubscriptionPlanSnapshot,
  type UnitPii,
} from '@/domain'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { Schema } from 'effect'
import { createHash, randomBytes } from 'node:crypto'
import type { FsDocument, FsValue } from './firestore-rest'
import { decodeFsDocument, decodeFsFieldsDoc, decodeFsQueryRows, parseJson } from './firestore-rest'

// Reusable lenient field schemas for the ad-hoc doc reads below. Each describes
// only the sub-fields the caller touches; excess properties are ignored, so the
// real (richer) emulator doc decodes fine.
const StringValue = Schema.Struct({ stringValue: Schema.optional(Schema.String) })
const NullableStringValue = Schema.Struct({
  stringValue: Schema.optional(Schema.String),
  nullValue: Schema.optional(Schema.Null),
})

// Auth REST shapes.
const decodeSignUp = Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.String }))
const decodeIdToken = Schema.decodeUnknownSync(
  Schema.Struct({ idToken: Schema.optional(Schema.String) }),
)

// Encodes a single JS value into the Firestore REST typed-value shape. Integers
// map to `integerValue` (Firestore's int encoding) and non-integers to
// `doubleValue`. `null` → the `nullValue` sentinel. `undefined` is never encoded
// — callers omit those keys (matches `Schema.optional` fields).
function toFsValue(value: unknown): FsValue {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFsValue) } }
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFsFields(value) } }
  }
  throw new Error(`toFsValue: unsupported value of type ${typeof value}`)
}

// Serializes a typed object literal to the Firestore REST `fields` map. Keys
// whose value is `undefined` are dropped (Firestore rejects `undefined`; the
// schema treats them as absent — `Schema.optional`).
function toFsFields(obj: object): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    fields[k] = toFsValue(v)
  }
  return fields
}

// Writes a typed object literal to `path`. The `doc` is annotated with the
// read-model type at the call site, so a missing field fails compilation.
function setDoc(path: string, doc: object): void {
  curlPut(`${fsBaseUrl()}/${path}`, { fields: toFsFields(doc) })
}

function uniqueSuffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

// Seeds a profit Goal projection doc (brief 0042) directly via the emulator —
// the Copiloto surface reads the projection (`goals/{id}`), so the read-side
// E2E doesn't need the full event append. Doc id is deterministic per
// (type, unit, period), mirroring `defineGoal`.
export function seedGoal(orgId: string, unitId: string, period: string, targetCents: number): void {
  const id = goalDocId('profit', unitId, period)
  const now = new Date().toISOString()
  const doc: Goal = {
    id,
    orgId,
    unitId,
    period,
    type: 'profit',
    targetCents,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/goals/${id}`, doc)
}

// User + Customer docs use the shared Test Data Builders `buildUser` /
// `buildStoredCustomer` (`@/shared/fixtures/domain-builders`), so the seed and the
// E2E helpers construct identical, strongly-typed domain docs (zero drift).

// Creates a fresh user, org, units, and (optional) professionals seeded
// directly through the Firestore REST emulator. Returns the IDs + login
// material; pair with `signInAndAttachSession` to authenticate the browser
// context.
export async function seedOrg(input: SeedOrgInput = {}): Promise<SeededOrg> {
  const {
    slotMinutes = 15,
    hasBusinessHours = true,
    unitCount = 1,
    professionalCount = 1,
    professionalOperationalStatus = 'operational',
    selfBookingPublished = true,
    vertical = 'barbershop',
    cancellationPolicy,
  } = input

  const password = 'E2E12345!'
  const email = `e2e+${uniqueSuffix()}@example.com`

  // 1) Sign up via Auth REST. The /verify-email gate was removed when auth
  //    moved to Google + Microsoft OAuth only (#824); we still flip
  //    emailVerified=true so the token mirrors what real OAuth issues.
  const signUp = curlJson(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
    decodeSignUp,
  )
  const uid = signUp.localId
  await getAdminAuth(adminApp()).updateUser(uid, { emailVerified: true })

  // 2) Seed org + membership + user doc + units + professionals via
  //    Firestore REST (PATCH = upsert). Field values must be encoded in the
  //    Firestore typed-value format.
  const orgId = `e2e-org-${uniqueSuffix()}`
  const now = new Date().toISOString()

  // Address/hours are required on every Unit (PRD Identidade v2). The
  // `hasBusinessHours` flag now selects between OPEN hours + a real address
  // (the "ready for public" publish-gate shape, #988) and the EMPTY (all-closed,
  // blank-address) zero-value — still a valid Unit, just not publish-ready.
  const address: StoredUnit['address'] = hasBusinessHours
    ? {
        postalCode: '01310100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Avenida Paulista',
        number: '1000',
        complement: null,
      }
    : EMPTY_ADDRESS

  const businessHours: StoredUnit['businessHours'] = hasBusinessHours
    ? {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: null,
        sunday: null,
      }
    : EMPTY_BUSINESS_HOURS

  // Org doc. Decoded as `StoredOrg` (omits `taxIdentity`, which lives in
  // the deletable PII doc) — so the fixture object must NOT carry it.
  const orgDoc: StoredOrg = {
    id: orgId,
    name: `E2E ${orgId}`,
    slug: `e2e-${orgId}`.toLowerCase(),
    vertical,
    ownerUserId: uid,
    fiscalProfile: { stage: 'informal' },
    selfBookingPublished,
    selfBookingPublishedAt: selfBookingPublished ? now : null,
    timezone: 'America/Sao_Paulo',
    slotMinutes,
    // Mirror what createOrg writes (DEFAULT_* fills) so the doc is
    // schema-complete — the read boundary now decodes StoredOrg, so a partial
    // fixture (the old shape) fails validation.
    branding: { logoUrl: null, bannerUrl: null, description: null },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    cancellationPolicy: {
      enabled: cancellationPolicy?.enabled ?? false,
      minNoticeMinutes: cancellationPolicy?.minNoticeMinutes ?? 120,
    },
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}`, orgDoc)

  // Membership (top-level)
  const membershipId = `${orgId}_${uid}`
  const ownerMembership: Membership = {
    id: membershipId,
    orgId,
    userId: uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    unitId: null,
    commissionRate: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  setDoc(`memberships/${membershipId}`, ownerMembership)

  // User doc (currentOrgId pointer). #838: pre-fill the completion step
  // since seeded owners conceptually skipped OAuth + the live capture form.
  setDoc(
    `users/${uid}`,
    buildUser(uid, now, {
      email,
      displayName: 'E2E Owner',
      emailVerified: true,
      currentOrgId: orgId,
      whatsapp: '5511900000000',
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )

  // Units
  const unitIds: string[] = []
  for (let i = 0; i < unitCount; i++) {
    const unitId = `e2e-unit-${uniqueSuffix()}`
    unitIds.push(unitId)
    const unitDoc: StoredUnit = {
      id: unitId,
      orgId,
      name: `Unidade ${i + 1}`,
      slug: `unidade-${i + 1}`,
      address,
      businessHours,
      // Default to the appointment hours mode so the unit drives the agenda
      // (unitUsesAgenda). The agenda page redirects to /orders when no unit
      // uses scheduling, which most specs depend on.
      hoursMode: 'appointment',
      // Uniform delete policy (brief 0027, #1041) — seeds match the new shape.
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    setDoc(`orgs/${orgId}/units/${unitId}`, unitDoc)
    // PII lives out of the unit projection (#1036 / ADR 0010): whatsapp/email
    // are stored in `units_pii/{id}` and merged at read time. Mirror the
    // product write path so listings/details surface the contact channels.
    const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
    setDoc(`orgs/${orgId}/units_pii/${unitId}`, unitPii)
  }

  // Professionals — each linked to all units
  const professionalIds: string[] = []
  for (let i = 0; i < professionalCount; i++) {
    const pid = `e2e-prof-${uniqueSuffix()}`
    professionalIds.push(pid)
    const proUid = `e2e-prof-user-${pid}`
    // Identity source of truth (#1046 / brief 0028 AC-04/AC-05): the global
    // User doc. The read path merges name/whatsapp/email LIVE from here.
    setDoc(
      `users/${proUid}`,
      buildUser(proUid, now, {
        email: `prof-${i + 1}-${pid}@e2e.local`,
        displayName: `Profissional ${i + 1}`,
        emailVerified: true,
        currentOrgId: orgId,
        whatsapp: '5511900000000',
        completionCompleted: true,
        claimedAt: now,
      }),
    )
    // Professional projection — decoded as `StoredProfessional` (omits the PII
    // name/whatsapp/email/taxIdentity, merged from `users/` + `professionals_pii`).
    const proDoc: StoredProfessional = {
      id: pid,
      orgId,
      // Non-null userId (#1045 / brief 0028 AC-01) — seeded fixtures honor
      // the same invariant as the product code: no Professional without a
      // linked User. Synthetic uid per professional, unique per seed run.
      userId: proUid,
      operationalStatus: professionalOperationalStatus,
      defaultCommission: null,
      unitIds: [...unitIds],
      serviceIds: [],
      createdAt: now,
      updatedAt: now,
    }
    setDoc(`orgs/${orgId}/professionals/${pid}`, proDoc)
    // Membership(role=professional) for the seeded professional (brief 0037
    // #1085): the Professional projection is the operational view of a member,
    // so the fixture honors the invariant projeção ⟺ membro role=professional.
    // This makes the pro show up in `/team` and its member detail navigable at
    // `/team/{proUid}`. Permissions = the professional default.
    const proMembershipId = `${orgId}_${proUid}`
    const proMembership: Membership = {
      id: proMembershipId,
      orgId,
      userId: proUid,
      role: 'professional',
      status: 'active',
      invitedBy: uid,
      joinedAt: now,
      updatedAt: now,
      unitId: null,
      commissionRate: null,
      permissions: defaultPermissionsForRole('professional'),
    }
    setDoc(`memberships/${proMembershipId}`, proMembership)
    // Per-org PII (#1036, ADR 0010) — after #1046 only `taxIdentity`.
    // Identity (name/whatsapp/email) lives on the global User (read live).
    const proPii: ProfessionalPii = { taxIdentity: null }
    setDoc(`orgs/${orgId}/professionals_pii/${pid}`, proPii)
  }

  return { uid, email, password, orgId, unitIds, professionalIds }
}

// Pins an existing membership to a single unit (brief 0029, AC-05). Mirrors
// what `membership.unitId` does in product code: the member is locked to that
// unit (no selector, no cross-unit access). Uses an updateMask so only
// `unitId` is patched (the emulator otherwise replaces the whole doc).
// Patches the membership `role` (brief 0029, AC-08). Lets a spec demote the
// seeded owner to e.g. `receptionist` so the role-filtered nav can be
// asserted. Uses an updateMask so only `role` is patched.
export function setMembershipRole(membershipId: string, role: string): void {
  const url = `${fsBaseUrl()}/memberships/${membershipId}?updateMask.fieldPaths=role`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { role: toFsValue(role) } }),
    ],
    { encoding: 'utf8' },
  )
}

// Flips a seeded subscription's `status` in place (updateMask PATCH). Used by
// the close-dialog E2E to simulate a subscription cancelled in another session
// AFTER an item was marked as plan-consumption — so `closeOrder` re-queries the
// active subscription, finds none, and rejects inline (the AC-03 contract).
export function setSubscriptionStatus(
  orgId: string,
  subscriptionId: string,
  status: 'pending' | 'active' | 'past_due' | 'suspended' | 'cancelled',
): void {
  const url = `${fsBaseUrl()}/orgs/${orgId}/subscriptions/${subscriptionId}?updateMask.fieldPaths=status`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { status: toFsValue(status) } }),
    ],
    { encoding: 'utf8' },
  )
}

export function setMembershipUnitId(membershipId: string, unitId: string | null): void {
  const url = `${fsBaseUrl()}/memberships/${membershipId}?updateMask.fieldPaths=unitId`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { unitId: toFsValue(unitId) } }),
    ],
    { encoding: 'utf8' },
  )
}

// Seeds an EXTRA active member into an existing org (brief 0030, AC-04/05):
// a User doc (live identity) + an active Membership with the given role. By
// design it does NOT create a Professional projection — so a `receptionist`
// seeded here has no approved Professional, which is exactly the case AC-05
// must unblock (a non-professional member can be attributed to a product/
// standalone item and the sale closes). Returns the member's global `userId`.
export function seedMember(
  orgId: string,
  opts: {
    role: 'manager' | 'professional' | 'receptionist'
    displayName: string
    unitId?: string | null
  },
): { userId: string } {
  const userId = `e2e-member-${uniqueSuffix()}`
  const now = new Date().toISOString()
  setDoc(
    `users/${userId}`,
    buildUser(userId, now, {
      email: `${userId}@e2e.local`,
      displayName: opts.displayName,
      emailVerified: true,
      currentOrgId: orgId,
      whatsapp: '5511900000000',
      completionCompleted: true,
      claimedAt: now,
    }),
  )
  const membershipId = `${orgId}_${userId}`
  // Custom permission set (not the role default): a non-professional member that
  // can manage customers + appointments — the AC-05 case (brief 0030).
  const permissions: MembershipPermissions = {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageServices: false,
    canManageProfessionals: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
  }
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId,
    role: opts.role,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    unitId: opts.unitId ?? null,
    commissionRate: null,
    permissions,
  }
  setDoc(`memberships/${membershipId}`, membership)
  return { userId }
}

// Seeds a COMPLETE active Membership for an ALREADY-EXISTING user (`userId`)
// without touching the global `users/{userId}` doc. Use when the member is an
// auth user created elsewhere (e.g. `seedAuthUser`) that must keep its login
// identity intact — unlike `seedMember`, which provisions its own user. Role
// permissions default to `defaultPermissionsForRole(role)`; pass `unitId` to
// scope the membership to a single unit. Returns the membership doc id.
export function seedMembershipFor(
  orgId: string,
  userId: string,
  opts: { role: Role; unitId?: string | null },
): string {
  const now = new Date().toISOString()
  const membershipId = membershipDocId(orgId, userId)
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId,
    role: opts.role,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    unitId: opts.unitId ?? null,
    commissionRate: null,
    permissions: defaultPermissionsForRole(opts.role),
  }
  setDoc(`memberships/${membershipId}`, membership)
  return membershipId
}

// Seeds a second org + units + an owner membership for an EXISTING user
// (brief 0029, AC-09). Use after `seedOrg` to give the seeded owner a
// membership in two orgs so the org switcher shows. Does NOT touch the
// user's `currentOrgId` (the spec switches via the UI). Returns the new
// org + unit ids.
export function seedAdditionalOrg(
  uid: string,
  opts: { name?: string; unitCount?: number } = {},
): { orgId: string; unitIds: string[] } {
  const unitCount = opts.unitCount ?? 1
  const orgId = `e2e-org-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? `E2E ${orgId}`

  const orgDoc: StoredOrg = {
    id: orgId,
    name,
    slug: `e2e-${orgId}`.toLowerCase(),
    vertical: 'barbershop',
    ownerUserId: uid,
    fiscalProfile: { stage: 'informal' },
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: 'America/Sao_Paulo',
    slotMinutes: 15,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}`, orgDoc)

  const membershipId = `${orgId}_${uid}`
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId: uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    unitId: null,
    commissionRate: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  setDoc(`memberships/${membershipId}`, membership)

  const unitIds: string[] = []
  for (let i = 0; i < unitCount; i++) {
    const unitId = `e2e-unit-${uniqueSuffix()}`
    unitIds.push(unitId)
    const unitDoc: StoredUnit = {
      id: unitId,
      orgId,
      name: `${name} Unidade ${i + 1}`,
      slug: `unidade-${i + 1}`,
      // Address/hours required on every Unit (PRD Identidade v2): extra seeded
      // units use the EMPTY zero-value (valid Unit, not publish-ready).
      address: EMPTY_ADDRESS,
      businessHours: EMPTY_BUSINESS_HOURS,
      hoursMode: 'appointment',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    setDoc(`orgs/${orgId}/units/${unitId}`, unitDoc)
    // PII out of the unit projection (#1036 / ADR 0010) — mirror the product
    // write path so reads merge whatsapp/email from `units_pii/{id}`.
    const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
    setDoc(`orgs/${orgId}/units_pii/${unitId}`, unitPii)
  }

  return { orgId, unitIds }
}

// ----------------------------------------------------------------------------
// Per-entity seeds — call after `seedOrg` for fixtures the spec needs.
// ----------------------------------------------------------------------------

export type SeedAppointmentInput = {
  orgId: string
  unitId: string
  professionalId: string
  customerId: string
  serviceId: string
  // ISO UTC.
  startAt: string
  endAt: string
  status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  // Snapshots (#875). Default mirrors the seedService default — 5000 cents,
  // 30 min, no commission. Specs that override the service should also
  // override these so the snapshot reflects the booking-time contract.
  servicePriceCentsSnapshot?: number
  serviceDurationMinutesSnapshot?: number
  commissionSnapshot?: { kind: 'percentage' | 'fixed'; value: number } | null
  // Snapshot da cancellation policy congelada no commit (#1038). Mirrors what
  // the real booking flow writes: customer self-cancel eligibility reads this,
  // not the live org policy. `undefined`/`null` → seeds a legacy (pre-
  // migration) appointment with no snapshot, exercising the live-policy fallback.
  cancellationPolicySnapshot?: { enabled: boolean; minNoticeMinutes: number } | null
}

function readCustomerUserId(orgId: string, customerId: string): string {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      `${fsBaseUrl()}/orgs/${orgId}/customers/${customerId}`,
      '-H',
      'Authorization: Bearer owner',
    ],
    { encoding: 'utf8' },
  )
  const json = parseJson(
    out,
    Schema.decodeUnknownSync(
      Schema.Struct({
        fields: Schema.optional(Schema.Struct({ userId: Schema.optional(StringValue) })),
      }),
    ),
  )
  const uid = json.fields?.userId?.stringValue
  if (!uid) throw new Error(`seedAppointment: customer ${customerId} has no userId`)
  return uid
}

function readProfessionalUserId(orgId: string, professionalId: string): string | null {
  try {
    const out = execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/professionals/${professionalId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    const json = parseJson(
      out,
      Schema.decodeUnknownSync(
        Schema.Struct({
          fields: Schema.optional(Schema.Struct({ userId: Schema.optional(NullableStringValue) })),
        }),
      ),
    )
    return json.fields?.userId?.stringValue ?? null
  } catch {
    return null
  }
}

// Reads the Professional projection linked to `userId` (≤1 per org) via a
// structured query against the emulator. Returns the projection id +
// `operationalStatus`, or null when no projection exists. Used by the role-edit
// lifecycle spec (#1086) to assert materialization (projection appears) and
// deactivation (operationalStatus leaves `operational` — off the public agenda).
export type ReadProfessionalResult = { id: string; operationalStatus: string }

export function readProfessionalByUserId(
  orgId: string,
  userId: string,
): ReadProfessionalResult | null {
  try {
    const out = execFileSync(
      'curl',
      [
        '-fsS',
        '-X',
        'POST',
        `${fsBaseUrl()}/orgs/${orgId}:runQuery`,
        '-H',
        'Authorization: Bearer owner',
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'professionals' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'userId' },
                op: 'EQUAL',
                value: { stringValue: userId },
              },
            },
            limit: 1,
          },
        }),
      ],
      { encoding: 'utf8' },
    )
    const rows = parseJson(out, decodeFsQueryRows)
    const doc = rows.find((r) => r.document)?.document
    if (!doc?.name) return null
    const id = doc.name.split('/').pop() ?? ''
    return { id, operationalStatus: doc.fields?.operationalStatus?.stringValue ?? 'incomplete' }
  } catch {
    return null
  }
}

export function seedAppointment(input: SeedAppointmentInput): string {
  const id = `e2e-appt-${uniqueSuffix()}`
  const now = new Date().toISOString()
  // Resolve the denormalized userId FKs at seed time so the doc matches
  // the new Appointment shape (#852 PR 4).
  const customerUserId = readCustomerUserId(input.orgId, input.customerId)
  const professionalUserId = readProfessionalUserId(input.orgId, input.professionalId)
  const doc: Appointment = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    professionalId: input.professionalId,
    customerId: input.customerId,
    serviceId: input.serviceId,
    startAt: input.startAt,
    endAt: input.endAt,
    status: input.status ?? 'scheduled',
    servicePriceCentsSnapshot: input.servicePriceCentsSnapshot ?? 5000,
    serviceDurationMinutesSnapshot: input.serviceDurationMinutesSnapshot ?? 30,
    commissionSnapshot: input.commissionSnapshot ?? null,
    cancellationPolicySnapshot: input.cancellationPolicySnapshot ?? null,
    customerUserId,
    professionalUserId,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${input.orgId}/appointments/${id}`, doc)
  return id
}

// Seeds the Customer + User stub pair the new schema requires (#852 PR 3).
// PII lives on the global User; the per-org Customer is operational only
// and references the User by FK.
export function seedCustomer(
  orgId: string,
  opts: {
    name?: string
    whatsapp?: string | null
    email?: string | null
    /** CPF do titular — necessário pra activateGatewayCharging (brief 0003). */
    document?: string | null
    /**
     * Override do uid do User canonical. Default cria User novo (`e2e-user-*`).
     * Passe `org.uid` quando precisar de Customer ligado ao usuário logado
     * (ex.: testes de `/me/subscriptions` que dependem de `customerUserId` ===
     * session.uid; #651).
     */
    userId?: string
    /** Override do avatar do User canonical (default null). Usado por specs de
     * neutralização de avatar no bloqueio per-org (#1100, AC-13). */
    avatarUrl?: string | null
  } = {},
): string {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const userId = opts.userId ?? `e2e-user-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? `Cliente ${customerId.slice(-4)}`

  // User stub — owns the PII.
  setDoc(
    `users/${userId}`,
    buildUser(userId, now, {
      email: opts.email ?? null,
      displayName: name,
      avatarUrl: opts.avatarUrl ?? null,
      whatsapp: opts.whatsapp ?? null,
    }),
  )

  // Per-org Customer shadow. Decoded as `StoredCustomer` (omits the PII
  // name/whatsapp/email/birthDate/avatarUrl, merged from `users/`). `document`
  // is a non-schema fixture field kept only when an opt is passed.
  const customerDoc: StoredCustomer = buildStoredCustomer(customerId, orgId, userId, now)
  setDoc(`orgs/${orgId}/customers/${customerId}`, {
    ...customerDoc,
    ...(opts.document ? { document: opts.document } : {}),
  })
  return customerId
}

// Seeds ONLY the per-org Customer shadow for an ALREADY-EXISTING user
// (`userId`), without touching the global `users/{userId}` doc. Use this when
// the subject is also an owner/member with a complete user doc that
// `seedCustomer` would otherwise clobber (resetting `completionCompleted`).
// Returns the customer id.
export function seedCustomerShadowForUser(orgId: string, userId: string): string {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const now = new Date().toISOString()
  setDoc(
    `orgs/${orgId}/customers/${customerId}`,
    buildStoredCustomer(customerId, orgId, userId, now),
  )
  return customerId
}

// True when a `blocked_subjects/{userId}` marker exists in `orgId` — the
// fact-of-record a per-org CUSTOMER block writes (brief 0032 / #1100). Used
// to assert a self-service per-establishment erasure blocked the right org
// (and only it).
export function blockedSubjectMarkerExists(orgId: string, userId: string): boolean {
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/blocked_subjects/${userId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    return true
  } catch {
    return false
  }
}

// Seeds a reverse-index link `users/{uid}/org_links/{orgId}` — what the
// customer-creation saga (brief 0032 / #1097, AC-10) writes server-side. The
// privacy surface reads the subject's OWN links to discover where they are a
// customer. References only (zero PII): orgId + linkedAt.
export function seedOrgLink(userId: string, orgId: string): void {
  const now = new Date().toISOString()
  const doc: OrgLink = { orgId, linkedAt: now }
  setDoc(`users/${userId}/org_links/${orgId}`, doc)
}

// Reads a reverse-index link doc directly (admin escape hatch). Returns the
// Firestore typed fields or null when the link is absent. Used to assert the
// index holds zero PII / scoping.
export function readOrgLink(userId: string, orgId: string): Record<string, unknown> | null {
  try {
    const out = execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/users/${userId}/org_links/${orgId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    const json = parseJson(out, decodeFsFieldsDoc)
    return json.fields ?? null
  } catch {
    return null
  }
}

/**
 * Seeds a Subscription doc directly into Firestore (skip create flow).
 * Used by brief 0003 E2E specs to exercise activateGatewayCharging UI.
 */
// Typed builders for the two optional plan-snapshot axes — each sub-field is
// omitted when its option is absent (mirrors the production snapshot). Returns
// the `AllowedTimeScope`/`BookingLimits` shapes (sub-fields `Schema.optional`).
function buildTimeScope(ts: {
  daysOfWeek?: number[]
  hourRange?: { start: string; end: string }
  advanceBookingDays?: number
}): AllowedTimeScope {
  const scope: AllowedTimeScope = {}
  if (ts.daysOfWeek) scope.daysOfWeek = [...ts.daysOfWeek]
  if (ts.hourRange) scope.hourRange = { start: ts.hourRange.start, end: ts.hourRange.end }
  if (typeof ts.advanceBookingDays === 'number') scope.advanceBookingDays = ts.advanceBookingDays
  return scope
}

function buildBookingLimits(limits: {
  maxPerDay?: number
  maxConcurrent?: number
  requireCompleteBeforeNext?: boolean
}): BookingLimits {
  const out: BookingLimits = {}
  if (limits.maxPerDay !== undefined) out.maxPerDay = limits.maxPerDay
  if (limits.maxConcurrent !== undefined) out.maxConcurrent = limits.maxConcurrent
  if (limits.requireCompleteBeforeNext !== undefined) {
    out.requireCompleteBeforeNext = limits.requireCompleteBeforeNext
  }
  return out
}

export function seedSubscription(
  orgId: string,
  customerId: string,
  opts: {
    planName?: string
    priceCents?: number
    status?: 'pending' | 'active' | 'past_due' | 'suspended' | 'cancelled'
    // Brief 0019 — congelar regras de plano no snapshot. Quando passados,
    // o plan snapshot carrega esses campos; o enforcement (reception +
    // self-book) lê deles via resolveCustomerSubscriptionScope. Cada axis
    // é independente — passar 1 não obriga passar os outros.
    unitAllowlist?: string[]
    allowedTimeScope?: {
      daysOfWeek?: number[]
      hourRange?: { start: string; end: string }
      advanceBookingDays?: number
    }
    bookingLimits?: {
      maxPerDay?: number
      maxConcurrent?: number
      requireCompleteBeforeNext?: boolean
    }
    // Brief 0021 — cobertura por item: plano por contagem + saldo já consumido
    // pra exercitar o caso degenerado (assinatura sem saldo).
    usageLimit?: { kind: 'unlimited' } | { kind: 'count'; quantity: number }
    consumed?: number
    // Brief 0023 (#1004) — cobertura por categoria. Quando não-vazio, o
    // enforcement bloqueia booking de serviço cuja categoria não está na lista.
    includedCategoryIds?: string[]
    // Brief 0024 (#1008/#1009) — cobertura por item granular (qualquer kind).
    // Snapshot congelado contra o qual o consumo (fechamento da comanda) resolve
    // se um item está coberto (item direto OU categoria expandida).
    includedItemIds?: string[]
    // Brief 0027 (#1041) — id do plano congelado no snapshot (`plan.planId`).
    // Default `'e2e-plan'`; passe o id real do plano pra exercitar o guard de
    // delete-in-use (deletePlan bloqueia quando `plan.planId == planId`).
    planId?: string
    // Brief 0043 (#1117) — unidade dona da assinatura. Default `'e2e-unit'`;
    // passe o id real pra exercitar o escopo por unidade (MRR/assinantes).
    unitId?: string
  } = {},
): string {
  const subId = `e2e-sub-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const startAt = new Date().toISOString()
  const endAt = new Date(Date.now() + 30 * 86400_000).toISOString()
  const planName = opts.planName ?? 'Plano Mensal Corte'
  const priceCents = opts.priceCents ?? 9000
  const status = opts.status ?? 'active'

  // Hidrata customerUserId a partir do Customer (#651 — pattern espelha
  // seedAppointment). Customer → User é FK denormalizada pra cross-org
  // CG query no /me/subscriptions.
  const customerUserId = readCustomerUserId(orgId, customerId)

  const plan: SubscriptionPlanSnapshot = {
    planId: opts.planId ?? 'e2e-plan',
    name: planName,
    priceCents,
    billingCycle: 'monthly',
    includedItemIds: [...(opts.includedItemIds ?? [])],
    includedCategoryIds: [...(opts.includedCategoryIds ?? [])],
    usageLimit:
      opts.usageLimit && opts.usageLimit.kind === 'count'
        ? { kind: 'count', quantity: opts.usageLimit.quantity }
        : { kind: 'unlimited' },
  }
  if (opts.unitAllowlist) plan.unitAllowlist = [...opts.unitAllowlist]
  if (opts.allowedTimeScope) plan.allowedTimeScope = buildTimeScope(opts.allowedTimeScope)
  if (opts.bookingLimits) plan.bookingLimits = buildBookingLimits(opts.bookingLimits)

  const currentPeriod: SubscriptionPeriod = {
    startAt,
    endAt,
    consumed: opts.consumed ?? 0,
  }
  const doc: Subscription = {
    id: subId,
    orgId,
    unitId: opts.unitId ?? 'e2e-unit',
    customerId,
    customerUserId: customerUserId || null,
    plan,
    status,
    currentPeriod,
    cancelAtPeriodEnd: false,
    nextChargeDate: endAt,
    cancellationReason: null,
    cancelledAt: null,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/subscriptions/${subId}`, doc)
  return subId
}

// Brief 0042 (#1115), AC-08 — receita recorrente reconhecida. Semeia uma
// cobrança de assinatura JÁ liquidada (`status: paid`, `paidAt` na janela) pra
// uma unidade. O realizado do Copiloto soma essas cobranças; o MRR fica à parte.
export function seedPaidCharge(
  orgId: string,
  opts: {
    unitId: string
    amountCents: number
    paidAt: string
    subscriptionId?: string
    customerId?: string
  },
): string {
  const chargeId = `e2e-charge-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: Charge = {
    id: chargeId,
    orgId,
    unitId: opts.unitId,
    subscriptionId: opts.subscriptionId ?? 'e2e-sub',
    customerId: opts.customerId ?? 'e2e-customer',
    amountCents: opts.amountCents,
    periodStartAt: opts.paidAt,
    periodEndAt: opts.paidAt,
    dueDate: opts.paidAt,
    status: 'paid',
    attempts: 1,
    paidAt: opts.paidAt,
    failedAt: null,
    failureReason: null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/charges/${chargeId}`, doc)
  return chargeId
}

export function seedService(
  orgId: string,
  opts: {
    name?: string
    category?: string | null
    durationMinutes?: number
    priceCents?: number
    commission?: { kind: 'percentage' | 'fixed'; value: number } | null
    publicVisible?: boolean
    priceVisibility?: 'visible' | 'on_request'
    unitIds?: string[]
    unitOverrides?: Record<string, { priceCents?: number; durationMinutes?: number }> | null
  } = {},
): string {
  const id = `e2e-svc-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const commission = opts.commission ?? null
  const unitIds = [...(opts.unitIds ?? [])]
  // `Service`/`CatalogItem` share the same per-unit override shape
  // (`ServiceUnitOverride` — every sub-field is `Schema.optional`). Build it as a
  // typed record; absent sub-fields stay omitted.
  const unitOverrides: Service['unitOverrides'] = opts.unitOverrides
    ? Object.fromEntries(
        Object.entries(opts.unitOverrides).map(([uid, o]) => {
          const inner: { priceCents?: number; durationMinutes?: number } = {}
          if (o.priceCents !== undefined) inner.priceCents = o.priceCents
          if (o.durationMinutes !== undefined) inner.durationMinutes = o.durationMinutes
          return [uid, inner]
        }),
      )
    : null

  // Legacy `services/{id}` doc — no longer read via converter (consumers migrated
  // to `catalog_items`), but kept schema-shaped against `Service` so a drift in
  // the legacy type still fails the build.
  const serviceDoc: Service = {
    id,
    orgId,
    name: opts.name ?? 'Corte',
    category: opts.category ?? null,
    durationMinutes: opts.durationMinutes ?? 30,
    priceCents: opts.priceCents ?? 5000,
    commission,
    requiredResources: [],
    active: true,
    publicVisible: opts.publicVisible ?? false,
    priceVisibility: opts.priceVisibility ?? 'visible',
    unitIds,
    unitOverrides,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/services/${id}`, serviceDoc)
  // Consumer migration (brief 0023, #1004): agenda/booking/order/public surfaces
  // now read `catalog_items` (decoded as `CatalogItem`). Mirror the service into a
  // kind-service catalog item with the SAME id so every existing spec that
  // books/orders against the returned id keeps resolving without rewrites.
  // `category` (free-text label) maps onto `categoryId` here.
  const catalogDoc: CatalogServiceItem = {
    id,
    orgId,
    kind: 'service',
    name: serviceDoc.name,
    categoryId: opts.category ?? null,
    priceCents: serviceDoc.priceCents,
    commission,
    unitIds,
    unitOverrides,
    publicVisible: serviceDoc.publicVisible,
    priceVisibility: serviceDoc.priceVisibility,
    active: true,
    archivedAt: null,
    durationMinutes: serviceDoc.durationMinutes,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/catalog_items/${id}`, catalogDoc)
  return id
}

// Attaches a list of serviceIds to an existing Professional doc. Specs that
// link professionals to bookable services post-seed used to inline this PATCH
// (4 copies); centralised to keep the typed-value encoding in one place.
//
// CRITICAL: PATCH must include `updateMask.fieldPaths=serviceIds` so Firestore
// only updates that field. Without the mask, the emulator replaces the entire
// document with the request body — wiping `unitIds`, `operationalStatus`, etc.,
// leaving the professional invisible to the booking flow.
export function linkProfessionalToServices(
  orgId: string,
  professionalId: string,
  serviceIds: string[],
): void {
  // Manual curl call so we can pass the updateMask query param (curlPut does
  // not surface it). Same auth + JSON shape as the other Firestore writes.
  const url = `${fsBaseUrl()}/orgs/${orgId}/professionals/${professionalId}?updateMask.fieldPaths=serviceIds`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { serviceIds: toFsValue(serviceIds) } }),
    ],
    { encoding: 'utf8' },
  )
}

export function seedProduct(
  orgId: string,
  opts: { name?: string; priceCents?: number; stock?: number; sku?: string } = {},
): string {
  const id = `e2e-prod-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? 'Pomada'
  const priceCents = opts.priceCents ?? 3000
  const stock = opts.stock ?? 100
  const sku = opts.sku ?? null
  const productDoc: Product = {
    id,
    orgId,
    name,
    sku,
    priceCents,
    stock,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/products/${id}`, productDoc)
  // Consumer migration (brief 0023, #1004): order close resolves products from
  // `catalog_items` (decoded as `CatalogItem`). Mirror with the same id (kind
  // product). `unitIds` is empty for the legacy product shape; the rule requires
  // non-empty, but these admin-surface writes bypass rules — and
  // `resolveCatalogItemForUnit` reads the base price when the unit has no
  // override, so an empty unit scope still resolves the order item correctly.
  const catalogDoc: CatalogProductItem = {
    id,
    orgId,
    kind: 'product',
    name,
    categoryId: null,
    priceCents,
    commission: null,
    unitIds: [],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    sku,
    stock,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/catalog_items/${id}`, catalogDoc)
  return id
}

// Seeds a unified CatalogItem doc (brief 0023) directly into Firestore.
// Discriminated by `kind`; service-only / product-only fields are written
// conditionally. Used by the catalog baseline E2E (no CRUD UI yet — #1005).
export function seedCatalogItem(
  orgId: string,
  opts: {
    kind?: 'service' | 'product'
    name?: string
    categoryId?: string | null
    priceCents?: number
    commission?: { kind: 'percentage' | 'fixed'; value: number } | null
    unitIds?: string[]
    publicVisible?: boolean
    active?: boolean
    // service-only
    durationMinutes?: number
    requiredResources?: string[]
    // product-only
    sku?: string | null
    stock?: number
  } = {},
): string {
  const kind = opts.kind ?? 'service'
  const id = `e2e-catalog-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const commission = opts.commission ?? null
  const baseFields = {
    id,
    orgId,
    name: opts.name ?? (kind === 'service' ? 'Corte Catálogo' : 'Pomada Catálogo'),
    categoryId: opts.categoryId ?? null,
    priceCents: opts.priceCents ?? (kind === 'service' ? 5000 : 3000),
    commission,
    unitIds: [...(opts.unitIds ?? [])],
    unitOverrides: null,
    publicVisible: opts.publicVisible ?? false,
    priceVisibility: 'visible' as const,
    active: opts.active ?? true,
    // Uniform delete policy (brief 0027, #1041) — seeds match the new shape.
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const doc: CatalogItem =
    kind === 'service'
      ? {
          ...baseFields,
          kind: 'service',
          durationMinutes: opts.durationMinutes ?? 30,
          requiredResources: [...(opts.requiredResources ?? [])],
        }
      : {
          ...baseFields,
          kind: 'product',
          sku: opts.sku ?? null,
          stock: opts.stock ?? 100,
        }
  setDoc(`orgs/${orgId}/catalog_items/${id}`, doc)
  return id
}

// Seeds a Category doc (brief 0023, #1003) directly into the emulator (admin
// bypass). `CatalogItem.categoryId` / `SubscriptionPlan.includedCategoryIds`
// are FKs into this id. Returns the generated id.
export function seedCategory(
  orgId: string,
  opts: {
    name?: string
    icon?: string | null
    color?: string | null
    active?: boolean
    // Brief 0033, bug 2: an archived category still labels items that point at
    // it. Pass an ISO string to seed a soft-deleted (archived) category.
    archivedAt?: string | null
  } = {},
): string {
  const id = `e2e-cat-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: Category = {
    id,
    orgId,
    name: opts.name ?? 'Cabelo',
    icon: opts.icon ?? null,
    color: opts.color ?? null,
    active: opts.active ?? true,
    // Uniform delete policy (brief 0027, #1041) — seeds match the new shape.
    archivedAt: opts.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/categories/${id}`, doc)
  return id
}

// Seeds an extra Unit into an existing org (brief 0033, bug 3). Unlike the
// units created inside `seedOrg`, this lets a spec add a SECOND unit and,
// crucially, mark it `archivedAt` to assert that a soft-deleted unit drops out
// of the switcher and active-unit resolution. Mirrors the unit shape +
// `units_pii` write of `seedOrg`.
export function seedUnit(
  orgId: string,
  opts: { name?: string; slug?: string; archivedAt?: string | null } = {},
): string {
  const id = `e2e-unit-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const slug = opts.slug ?? `unidade-${id}`.toLowerCase()
  const unitDoc: StoredUnit = {
    id,
    orgId,
    name: opts.name ?? 'Unidade Extra',
    slug,
    // Address/hours required on every Unit (PRD Identidade v2): the extra
    // seeded unit uses the EMPTY zero-value (valid Unit, not publish-ready).
    address: EMPTY_ADDRESS,
    businessHours: EMPTY_BUSINESS_HOURS,
    hoursMode: 'appointment',
    archivedAt: opts.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/units/${id}`, unitDoc)
  const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
  setDoc(`orgs/${orgId}/units_pii/${id}`, unitPii)
  return id
}

// Seeds a minimal SubscriptionPlan referencing category FK ids — used by the
// #1003 baseline to exercise the AC-05 in-use guard (a plan referencing the
// category must block its deletion).
export function seedSubscriptionPlan(
  orgId: string,
  opts: {
    name?: string
    // Preço do plano em centavos. Default 9000; passe um valor quando o teste
    // assertar o preço exibido na UI (ex.: troca de plano comparando destinos).
    priceCents?: number
    includedItemIds?: string[]
    includedCategoryIds?: string[]
    // Brief 0033, bug 1: a discontinued (soft-deleted) plan. Pass an ISO string
    // to seed an archived plan that the new-subscription picker must filter out.
    archivedAt?: string | null
  } = {},
): string {
  const id = `e2e-plan-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: SubscriptionPlan = {
    id,
    orgId,
    name: opts.name ?? 'Plano Baseline',
    description: null,
    priceCents: opts.priceCents ?? 9000,
    billingCycle: 'monthly',
    // Per-item coverage (brief 0024, #1008) — refs to catalog items of any
    // kind. Convenience category coverage rides alongside (#1003).
    includedItemIds: [...(opts.includedItemIds ?? [])],
    includedCategoryIds: [...(opts.includedCategoryIds ?? [])],
    usageLimit: { kind: 'unlimited' },
    active: true,
    // Uniform delete policy (brief 0027, #1041) — seeds match the new shape.
    archivedAt: opts.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${orgId}/subscription_plans/${id}`, doc)
  return id
}

// Reads a CatalogItem back from the Firestore emulator (typed-value shape).
// Returns the raw `fields` map (null when absent) so specs can assert the
// rules-gated read path projects the doc.
export function readCatalogItem(
  orgId: string,
  catalogItemId: string,
): Record<string, FsValue> | null {
  try {
    const out = execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/catalog_items/${catalogItemId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    const json = parseJson(out, decodeFsFieldsDoc)
    return json.fields ?? null
  } catch {
    return null
  }
}

// Patches an existing Appointment's financial snapshot fields directly via the
// Firestore emulator (admin bypass). Mirrors what `updateAppointment` writes
// when the owner swaps the booked service/unit (`appointment.updated` carrying
// servicePriceCentsSnapshot/commissionSnapshot). Used by the drift regression
// (#1037) to mutate the appointment AFTER its order exists, proving the order's
// value-copied snapshot does NOT follow.
//
// CRITICAL: PATCH must include `updateMask.fieldPaths` for each field so the
// emulator patches only those — without the mask it replaces the whole document.
export function patchAppointmentSnapshot(
  orgId: string,
  appointmentId: string,
  snapshot: {
    servicePriceCentsSnapshot: number
    commissionSnapshot: { kind: 'percentage' | 'fixed'; value: number } | null
  },
): void {
  const mask =
    'updateMask.fieldPaths=servicePriceCentsSnapshot&updateMask.fieldPaths=commissionSnapshot'
  const url = `${fsBaseUrl()}/orgs/${orgId}/appointments/${appointmentId}?${mask}`
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      url,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: toFsFields({
          servicePriceCentsSnapshot: snapshot.servicePriceCentsSnapshot,
          commissionSnapshot: snapshot.commissionSnapshot,
        } satisfies Pick<Appointment, 'servicePriceCentsSnapshot' | 'commissionSnapshot'>),
      }),
    ],
    { encoding: 'utf8' },
  )
}

// Reads an Appointment back from the Firestore emulator (typed-value shape).
// Used by the consumer-migration spec (#1004) to assert the booking still
// references the catalog service id and froze the price/duration/commission
// snapshots. Returns null when absent.
export function readAppointment(
  orgId: string,
  appointmentId: string,
): Record<string, FsValue> | null {
  try {
    const out = execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/appointments/${appointmentId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
    const json = parseJson(out, decodeFsFieldsDoc)
    return json.fields ?? null
  } catch {
    return null
  }
}

// Lists appointment ids for a org — lets a spec find the doc a UI flow just
// created without knowing the generated id.
export function listAppointmentIds(orgId: string): string[] {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', `${fsBaseUrl()}/orgs/${orgId}/appointments`, '-H', 'Authorization: Bearer owner'],
      { encoding: 'utf8' },
    )
    const json = parseJson(
      out,
      Schema.decodeUnknownSync(
        Schema.Struct({
          documents: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
        }),
      ),
    )
    return (json.documents ?? []).map((d) => d.name.split('/').pop() ?? '')
  } catch {
    return []
  }
}

// True when the agenda-block doc still exists (offboarding cleanup assertion,
// brief 0041 AC-07). A successful GET (doc present) returns true; a 404 throws.
export function blockExists(orgId: string, blockId: string): boolean {
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/agenda_blocks/${blockId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { stdio: 'pipe' },
    )
    return true
  } catch {
    return false
  }
}

// Seeds an OPEN order/comanda with a single service item attributed to
// `attributedUserId` (the member's GLOBAL userId — brief 0030 AC-04). Used by
// the offboarding veto spec (brief 0041 AC-05): an open comanda attributed to a
// member refuses their removal until it's settled.
export function seedOpenOrder(input: {
  orgId: string
  unitId: string
  customerId: string | null
  attributedUserId: string
  // Override the order total (drives the comanda list / dashboard pendency
  // amount). Default 1000. The single seeded item mirrors this value.
  totalCents?: number
  // Backdate the order so it surfaces as a stale-comanda pendency (>24h open,
  // see `selectOpenOrderPendencies`, which reads `createdAt`). Default now.
  createdAt?: string
}): string {
  const id = `e2e-order-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const totalCents = input.totalCents ?? 1000
  const createdAt = input.createdAt ?? now
  const item: OrderItem = {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: totalCents,
    commission: null,
    attributedUserId: input.attributedUserId,
  }
  const doc: Order = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    customerId: input.customerId,
    appointmentId: null,
    status: 'open',
    items: [item],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: totalCents,
    totalCents,
    createdAt,
    updatedAt: createdAt,
  }
  setDoc(`orgs/${input.orgId}/orders/${id}`, doc)
  return id
}

// Seed a CLOSED order for the active unit — counts as realizado avulso in the
// Copiloto read-model (status=closed + closedAt within the period window +
// unitId). `totalCents` drives the recognized revenue; the returned id links a
// commission against it (see `seedCommission({ orderId })`). Mirrors the open
// order seed but in its settled terminal state.
export function seedClosedOrder(input: {
  orgId: string
  unitId: string
  customerId: string | null
  attributedUserId: string
  totalCents: number
  closedAt?: string
  // Payment method snapshot frozen at close. Default `cash`. A fully
  // subscription-covered close writes `subscription` with `totalCents: 0`
  // (no cash changes hands) — see `seedSubscriptionCoveredOrder` callers.
  paymentMethod?: Order['paymentMethod']
  // Pre-discount subtotal. Default `totalCents`. A covered close keeps the
  // gross subtotal (the catalog price) while `totalCents` settles to 0.
  subtotalCents?: number
  // Fiscal nature of the single seeded item (brief 0021): `sale` (default)
  // composes revenue; `subscription` debits a plan balance and emits no
  // `sale` cash movement, so it never composes period revenue. When
  // `subscription`, `subscriptionId` links the debited subscription.
  coverage?: OrderCoverage
  subscriptionId?: string | null
}): string {
  const id = `e2e-order-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const closedAt = input.closedAt ?? now
  const subtotalCents = input.subtotalCents ?? input.totalCents
  const item: OrderItem = {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: subtotalCents,
    commission: null,
    attributedUserId: input.attributedUserId,
    ...(input.coverage ? { coverage: input.coverage } : {}),
    ...(input.coverage === 'subscription' ? { subscriptionId: input.subscriptionId ?? null } : {}),
  }
  const doc: Order = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    customerId: input.customerId,
    appointmentId: null,
    status: 'closed',
    items: [item],
    discountCents: 0,
    closedAt,
    paymentMethod: input.paymentMethod ?? 'cash',
    subtotalCents,
    totalCents: input.totalCents,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${input.orgId}/orders/${id}`, doc)
  return id
}

// Seed a commission attributed to a member (brief 0041 #1105 AC-06). Used to
// drive the pending-commission veto in the offboarding E2E. `liquidationStatus`
// defaults to `pendente` (the state that blocks removal).
export function seedCommission(input: {
  orgId: string
  attributedUserId: string
  amountCents: number
  liquidationStatus?: 'pendente' | 'pago'
  // Link the commission to a real closed order so unit-scoped read-models that
  // map commission → order (e.g. the Copiloto realizado-após-comissão) pick it
  // up. Defaults to the standalone ref used by the offboarding E2E (no order to
  // map against).
  orderId?: string
  // Nome do item da comissão (default 'Corte'). Passe quando o teste assertar o
  // rótulo do item na lista de comissões (ex.: relatório/marcar-pago).
  itemName?: string
  // Nome do membro congelado no snapshot de retenção (default 'E2E Profissional').
  // Passe quando o teste assertar o nome identificável que sobrevive à remoção/
  // anonimização do membro.
  attributedMemberName?: string
}): string {
  const id = `e2e-commission-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const status = input.liquidationStatus ?? 'pendente'
  const doc: Commission = {
    id,
    orgId: input.orgId,
    orderId: input.orderId ?? 'e2e-order-ref',
    orderItemId: 'item-1',
    attributedUserId: input.attributedUserId,
    // Retention snapshot (brief 0041 AC-11): the identifiable member name frozen
    // at accrual, surviving offboarding/anonymization. Seeded with a placeholder.
    attributedMemberName: input.attributedMemberName ?? 'E2E Profissional',
    itemKind: 'service',
    itemName: input.itemName ?? 'Corte',
    itemTotalCents: input.amountCents * 2,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: input.amountCents,
    liquidationStatus: status,
    paidAt: status === 'pago' ? now : null,
    paymentProof: null,
    createdAt: now,
  }
  setDoc(`orgs/${input.orgId}/commissions/${id}`, doc)
  return id
}

// Reads back a commission doc (attribution + liquidation status). Used by the
// offboarding E2E to prove the removed member's commissions are LEFT untouched
// (identifiable, still pending) — the offboarding no longer reads/gates on them.
export function readCommission(
  orgId: string,
  commissionId: string,
): { attributedUserId: string | null; liquidationStatus: string | null } | null {
  let out = ''
  try {
    out = execFileSync(
      'curl',
      [
        '-fsS',
        `${fsBaseUrl()}/orgs/${orgId}/commissions/${commissionId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
  } catch {
    return null
  }
  const json = parseJson(
    out,
    Schema.decodeUnknownSync(
      Schema.Struct({
        fields: Schema.optional(
          Schema.Struct({
            attributedUserId: Schema.optional(StringValue),
            liquidationStatus: Schema.optional(StringValue),
          }),
        ),
      }),
    ),
  )
  if (!json.fields) return null
  return {
    attributedUserId: json.fields.attributedUserId?.stringValue ?? null,
    liquidationStatus: json.fields.liquidationStatus?.stringValue ?? null,
  }
}

export type SeedBlockInput =
  | {
      kind: 'recurring'
      orgId: string
      unitId: string
      professionalId?: string | null
      weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
      open: string
      close: string
      reason: string
    }
  | {
      kind: 'one_off'
      orgId: string
      unitId: string
      professionalId?: string | null
      // ISO UTC.
      startAt: string
      endAt: string
      reason: string
    }

export function seedBlock(input: SeedBlockInput): string {
  const id = `e2e-block-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const base = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    professionalId: input.professionalId ?? null,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  }
  const doc: AgendaBlock =
    input.kind === 'recurring'
      ? {
          ...base,
          kind: 'recurring',
          weekday: input.weekday,
          open: input.open,
          close: input.close,
          startAt: null,
          endAt: null,
        }
      : {
          ...base,
          kind: 'one_off',
          weekday: null,
          open: null,
          close: null,
          startAt: input.startAt,
          endAt: input.endAt,
        }
  setDoc(`orgs/${input.orgId}/agenda_blocks/${id}`, doc)
  return id
}

// Creates an additional auth user (no org) and returns its credentials.
// Useful for invite-flow specs that need a second authenticated identity to
// accept an invite created by the seed owner.
export async function seedAuthUser(
  opts: { email?: string; password?: string; completionCompleted?: boolean } = {},
): Promise<{ uid: string; email: string; password: string }> {
  const password = opts.password ?? 'E2E12345!'
  const email = opts.email ?? `e2e+${uniqueSuffix()}@example.com`
  const signUp = curlJson(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
    decodeSignUp,
  )
  const uid = signUp.localId
  await getAdminAuth(adminApp()).updateUser(uid, { emailVerified: true })

  // #838: pre-seed the Firestore user doc with completionCompleted so the
  // invitee can hit /invites/... without bouncing through /onboarding/profile.
  // Defaults to true since most specs care about the post-completion world.
  // Pass `completionCompleted: false` to exercise the gate explicitly.
  const completionCompleted = opts.completionCompleted ?? true
  const now = new Date().toISOString()
  setDoc(
    `users/${uid}`,
    buildUser(uid, now, {
      email,
      displayName: 'E2E Invitee',
      emailVerified: true,
      whatsapp: completionCompleted ? '5511900000000' : null,
      birthDate: completionCompleted ? '1990-01-01' : null,
      completionCompleted,
      claimedAt: now,
    }),
  )

  return { uid, email, password }
}

export type SeedInviteInput = {
  orgId: string
  email: string
  role: 'manager' | 'professional' | 'receptionist'
  invitedBy: string
  // Defaults to now + 7d. Pass a past ISO to seed an expired invite.
  expiresAt?: string
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
}

// Seeds an invite doc with a sha256-hashed token. Returns the inviteId and the
// raw token so the spec can build the accept URL.
export function seedInvite(input: SeedInviteInput): { inviteId: string; rawToken: string } {
  const inviteId = `e2e-invite-${uniqueSuffix()}`
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const now = new Date().toISOString()
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  // Invite projection — decoded as `StoredInvite` (omits the PII `email`, which
  // lives in `invites_pii/{id}` and is merged at read time). The schema enforces
  // `acceptedByUid`/`acceptedAt` present iff `status === 'accepted'`, so an
  // accepted seed must carry both (else it fails to decode and crashes reads).
  const status = input.status ?? 'pending'
  const accepted = status === 'accepted'
  const inviteDoc: StoredInvite = {
    id: inviteId,
    orgId: input.orgId,
    role: input.role,
    tokenHash,
    expiresAt,
    status,
    invitedBy: input.invitedBy,
    acceptedByUid: accepted ? `e2e-accepted-${uniqueSuffix()}` : null,
    acceptedAt: accepted ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  setDoc(`orgs/${input.orgId}/invites/${inviteId}`, inviteDoc)
  // The invitee email is PII (#1036, ADR 0010): it lives in the deletable
  // `invites_pii/{id}` doc, NOT on the invite projection. The product read
  // path (`getInviteById`) merges it from here — without it, `invite.email`
  // reads as '' and the accept-flow email match always fails. Mirrors
  // `writeInvitePii`.
  const invitePii: InvitePii = { email: input.email }
  setDoc(`orgs/${input.orgId}/invites_pii/${inviteId}`, invitePii)
  return { inviteId, rawToken }
}

// Reads an invite back from the Firestore emulator (typed-value shape).
export function readInviteStatus(orgId: string, inviteId: string): string | null {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      `${fsBaseUrl()}/orgs/${orgId}/invites/${inviteId}`,
      '-H',
      'Authorization: Bearer owner',
    ],
    { encoding: 'utf8' },
  )
  const json = parseJson(
    out,
    Schema.decodeUnknownSync(
      Schema.Struct({
        fields: Schema.optional(Schema.Struct({ status: Schema.optional(StringValue) })),
      }),
    ),
  )
  return json.fields?.status?.stringValue ?? null
}

export function readInvite(
  orgId: string,
  inviteId: string,
): { status: string; acceptedByUid: string | null; acceptedAt: string | null } | null {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      `${fsBaseUrl()}/orgs/${orgId}/invites/${inviteId}`,
      '-H',
      'Authorization: Bearer owner',
    ],
    { encoding: 'utf8' },
  )
  const json = parseJson(
    out,
    Schema.decodeUnknownSync(
      Schema.Struct({
        fields: Schema.optional(
          Schema.Struct({
            status: Schema.optional(StringValue),
            acceptedByUid: Schema.optional(NullableStringValue),
            acceptedAt: Schema.optional(NullableStringValue),
          }),
        ),
      }),
    ),
  )
  if (!json.fields) return null
  return {
    status: json.fields.status?.stringValue ?? 'pending',
    acceptedByUid: json.fields.acceptedByUid?.stringValue ?? null,
    acceptedAt: json.fields.acceptedAt?.stringValue ?? null,
  }
}

export type ReadMembershipResult = {
  orgId: string
  role: string
  status: string
  unitId: string | null
  commissionRate: number | null
  permissions: Record<string, boolean> | null
}

export function readMembership(membershipId: string): ReadMembershipResult | null {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', `${fsBaseUrl()}/memberships/${membershipId}`, '-H', 'Authorization: Bearer owner'],
      { encoding: 'utf8' },
    )
    const FsBool = Schema.Struct({ booleanValue: Schema.optional(Schema.Boolean) })
    const FsNumber = Schema.Struct({
      doubleValue: Schema.optional(Schema.Number),
      integerValue: Schema.optional(Schema.String),
      nullValue: Schema.optional(Schema.Null),
    })
    const FsMap = Schema.Struct({
      mapValue: Schema.optional(
        Schema.Struct({
          fields: Schema.optional(Schema.Record({ key: Schema.String, value: FsBool })),
        }),
      ),
      nullValue: Schema.optional(Schema.Null),
    })
    const json = parseJson(
      out,
      Schema.decodeUnknownSync(
        Schema.Struct({
          fields: Schema.optional(
            Schema.Struct({
              orgId: Schema.optional(StringValue),
              role: Schema.optional(StringValue),
              status: Schema.optional(StringValue),
              unitId: Schema.optional(NullableStringValue),
              commissionRate: Schema.optional(FsNumber),
              permissions: Schema.optional(FsMap),
            }),
          ),
        }),
      ),
    )
    if (!json.fields) return null
    const permissionsRaw = json.fields.permissions?.mapValue?.fields
    const permissions = permissionsRaw
      ? Object.fromEntries(
          Object.entries(permissionsRaw).map(([k, v]) => [k, v.booleanValue ?? false]),
        )
      : null
    const commissionRaw = json.fields.commissionRate
    let commissionRate: number | null = null
    if (commissionRaw?.doubleValue !== undefined) commissionRate = commissionRaw.doubleValue
    else if (commissionRaw?.integerValue !== undefined)
      commissionRate = Number(commissionRaw.integerValue)
    return {
      orgId: json.fields.orgId?.stringValue ?? '',
      role: json.fields.role?.stringValue ?? '',
      status: json.fields.status?.stringValue ?? '',
      unitId: json.fields.unitId?.stringValue ?? null,
      commissionRate,
      permissions,
    }
  } catch {
    return null
  }
}

export function readUser(uid: string): Record<string, FsValue> | null {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', `${fsBaseUrl()}/users/${uid}`, '-H', 'Authorization: Bearer owner'],
      { encoding: 'utf8' },
    )
    const json = parseJson(out, decodeFsFieldsDoc)
    return json.fields ?? null
  } catch {
    return null
  }
}

// Sign in via Auth REST + POST idToken to `/api/session` to mint the
// httpOnly `__session` cookie, then attach it to the Playwright context.
// `baseURL` defaults to the Playwright project config — pass an override only
// when the spec uses a different host.
export async function signInAndAttachSession(
  context: BrowserContext,
  email: string,
  password = 'E2E12345!',
  appUrl = 'http://127.0.0.1:3005',
): Promise<void> {
  const tokenJson = curlJson(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
    decodeIdToken,
  )
  if (!tokenJson.idToken) throw new Error('No idToken from auth emulator')
  const cookie = curlSetCookie(`${appUrl}/api/session`, { idToken: tokenJson.idToken })

  await context.addCookies([
    {
      name: '__session',
      value: cookie,
      url: appUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

// Active-unit cookie (brief 0029). A org with 2+ units and no chosen unit is
// sent to the `/select-unit` interstitial — pin the active unit by writing the
// cookie the picker would set, so operational/CRUD routes resolve directly.
export const ACTIVE_UNIT_COOKIE = 'activeUnitId'

export async function setActiveUnitCookie(
  context: BrowserContext,
  unitId: string,
  appUrl = 'http://127.0.0.1:3005',
): Promise<void> {
  const url = new URL(appUrl)
  await context.addCookies([
    {
      name: ACTIVE_UNIT_COOKIE,
      value: unitId,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

// After creating a unit via the `/units/new` form, the action redirects to
// `/units` — but if the create crossed the org into 2+ units with no chosen
// unit, the layout bounces to the `/select-unit` interstitial first (brief 0029
// AC-04). Wait for the post-create navigation to settle, pick a unit if the
// interstitial showed, and leave the browser on the `/units` listing so the
// caller can assert the created unit is there.
export async function enterUnitsAfterCreate(page: Page): Promise<void> {
  // The create action redirects to `/units`, but the `(app)` layout then bounces
  // a now-multi-unit org with no chosen unit to `/select-unit`. That transient
  // `/units` hop means we can't trust the immediate post-create URL — first let
  // the post-create navigation settle, then navigate to `/units` ourselves and,
  // if the interstitial shows, pin the first offered unit via the cookie (more
  // robust than the picker's async transition) and retry.
  await page.waitForURL(/\/(units|select-unit|agenda)$/, { timeout: 10000 })
  await page.goto('/units')
  if (/\/select-unit$/.test(new URL(page.url()).pathname)) {
    // The interstitial renders one submit button per unit; each carries its
    // unit id in the form `value` attribute (stable, accessible-query-safe).
    const unitId = await page
      .getByRole('button', { name: /Unidade/ })
      .first()
      .getAttribute('value')
    if (unitId) await setActiveUnitCookie(page.context(), unitId, page.url())
    await page.goto('/units')
  }
  await expect(page).toHaveURL(/\/units$/)
}
