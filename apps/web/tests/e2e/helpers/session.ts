// Test helpers for E2E specs that need an authenticated session. Auth runs
// against the Firebase Auth emulator (a thin wrapper over its REST API, so we
// don't import firebase-admin into Playwright workers); data is seeded into the
// Postgres event store (post-cutover #1202 Postgres is the only backend).
//
// Pre-reqs (see `playwright.config.ts` webServer.env):
// - Firebase Auth emulator (port 9099) running.
// - The ephemeral `oilio` Postgres database reachable via `OILIO_DATABASE_URL`,
//   with the event-store migrations applied (`scripts/e2e-with-postgres.mjs`).

import { expect, type BrowserContext, type Page } from '@playwright/test'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { execFileSync } from 'node:child_process'
import { AUTH_HOST, PROJECT_ID } from './emulator'

const API_KEY = 'fake-api-key'

// Admin SDK pointed at the emulator. Used for the email-verified flip
// (the REST `accounts:update` returns 200 but doesn't actually persist the
// field in the auth emulator — flagged via signInWithPassword returning
// email_verified=false in subsequent tokens). The admin path works.
// The emulator host env is injected by `firebase emulators:exec`; the SDK
// reads FIREBASE_AUTH_EMULATOR_HOST directly.
let cachedAdminApp: App | undefined
function adminApp(): App {
  if (cachedAdminApp) return cachedAdminApp
  const existing: App | undefined = getApps()[0]
  const created: App = existing ?? initializeApp({ projectId: PROJECT_ID })
  cachedAdminApp = created
  return created
}

export type SeedOrgInput = {
  // Mirrors the `SlotMinutes` read-model literal (5|10|15|30) — the value lands
  // on the unit's appointment agenda `slotMinutes` (moved Org→Unit, context 3),
  // so the union must match the schema.
  slotMinutes?: 5 | 10 | 15 | 30
  hasBusinessHours?: boolean
  unitCount?: number
  memberOperationCount?: number
  memberOperationOperationalStatus?: 'incomplete' | 'operational'
  // Self-booking publication gate (#988) — controls public page visibility.
  // Default true matches the 99% case where specs target an already-published
  // unit; pass `false` to seed an unpublished one (public page 404s). Per-unit
  // now (moved Org→Unit, context 3) — applied to the unit's appointment agenda.
  selfBookingPublished?: boolean
  vertical?: 'barbershop' | 'auto_wash' | 'auto_detailing' | 'other'
  cancellationPolicy?: { enabled: boolean; minNoticeMinutes: number }
  // Assinatura Oilio tier (brief 0072 gating). Defaults to `advanced` so the
  // seeded org has ALL capabilities — preserving the pre-gating assumption every
  // existing spec relies on (create plans, copilot goal, commissions, 2nd unit).
  // Gating-specific specs pass `'free'` (no Stripe row written) or `'pro'`.
  tier?: 'free' | 'pro' | 'advanced'
}

export type SeededOrg = {
  uid: string
  email: string
  password: string
  orgId: string
  unitIds: string[]
  memberOperationIds: string[]
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

// ── Type-driven Postgres seeds ────────────────────────────────────────────────
//
// Fixture docs are built as TYPED object literals annotated with the read-model
// type the READ boundary decodes that collection with (`Stored*` for the
// PII-omitting projections). A missing/renamed field then fails `tsc` — the
// fixtures consume `@/domain` as the single source of truth, so schema drift is
// a compile-time error instead of a silent incomplete projection that the
// validated reads (`decodeAs`/`Schema.decodeUnknownSync`) reject at runtime.
//
// The typed object is written into the Postgres event store (the seed appends
// the `*.created` event + the typed projection row in one tx, the same shape the
// app writes at runtime — see `seedIdentityPostgres`). The type annotation on
// each object literal — NOT the transport — is what catches drift. Post-cutover
// (#1202) Postgres is the only backend; Firebase is reduced to Auth.

import {
  Appointment as AppointmentSchema,
  CatalogItem as CatalogItemSchema,
  defaultPermissionsForRole,
  EMPTY_ADDRESS,
  EMPTY_BUSINESS_HOURS,
  goalDocId,
  membershipDocId,
  Membership as MembershipSchema,
  Role as RoleSchema,
  StoredMemberOperation as StoredMemberOperationSchema,
  Subscription as SubscriptionSchema,
  type AgendaBlock,
  type AllowedTimeScope,
  type Appointment,
  type BookingLimits,
  type BusinessHours,
  type CatalogItem,
  type CatalogProductItem,
  type CatalogServiceItem,
  type Category,
  type Charge,
  type Commission,
  type Goal,
  type InvitePii,
  type MemberOperationPii,
  type Membership,
  type MembershipPermissions,
  type Order,
  type OrderCoverage,
  type OrderItem,
  type Role,
  type StoredCustomer,
  type StoredInvite,
  type StoredMemberOperation,
  type StoredOrg,
  type StoredUnit,
  type Subscription,
  type SubscriptionPeriod,
  type SubscriptionPlan,
  type SubscriptionPlanSnapshot,
  type UnitPii,
  type User,
} from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CatalogItemConfig,
  CategoryConfig,
  ChargeConfig,
  CommissionConfig,
  CustomerConfig,
  deriveOperationalStatus,
  GoalConfig,
  InviteConfig,
  MemberOperationConfig,
  MembershipConfig,
  OrderConfig,
  OrgConfig,
  SubscriptionConfig,
  SubscriptionPlanConfig,
  UnitConfig,
} from '@/domain/aggregates'
import { aggregateRef, type AggregateRef } from '@/domain/effect'
import {
  AGENDA_BLOCK_COLUMNS,
  agendaBlockColumnValues,
} from '@/shared/db/pg/effect/agenda-block-projector'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  CATALOG_ITEM_COLUMNS,
  catalogItemColumnValues,
  rowToDoc as catalogItemRowToDoc,
  type CatalogItemRow,
} from '@/shared/db/pg/effect/catalog-item-projector'
import { CATEGORY_COLUMNS, categoryColumnValues } from '@/shared/db/pg/effect/category-projector'
import { CHARGE_COLUMNS, chargeColumnValues } from '@/shared/db/pg/effect/charge-projector'
import {
  COMMISSION_COLUMNS,
  commissionColumnValues,
} from '@/shared/db/pg/effect/commission-projector'
import { CUSTOMER_COLUMNS, customerColumnValues } from '@/shared/db/pg/effect/customer-projector'
import { GOAL_COLUMNS, goalColumnValues } from '@/shared/db/pg/effect/goal-projector'
import {
  INVITE_COLUMNS,
  inviteColumnValues,
  type InviteRow,
} from '@/shared/db/pg/effect/invite-projector'
import {
  MEMBER_OPERATION_COLUMNS,
  MEMBER_OPERATION_SERVICES_DELETE,
  MEMBER_OPERATION_SERVICES_INSERT,
  MEMBER_OPERATION_UNITS_INSERT,
  memberOperationColumnValues,
  rowToDoc as memberOperationRowToDoc,
  memberOperationServiceRows,
  memberOperationUnitRows,
  type MemberOperationRow,
} from '@/shared/db/pg/effect/member-operation-projector'
import {
  MEMBERSHIP_COLUMNS,
  membershipColumnValues,
  rowToDoc as membershipRowToDoc,
  type MembershipRow,
} from '@/shared/db/pg/effect/membership-projector'
import { ORDER_COLUMNS, orderColumnValues } from '@/shared/db/pg/effect/order-projector'
import {
  ORG_COLUMNS,
  orgColumnValues,
  PUBLIC_DIRECTORY_UPSERT,
  publicOrgDirectoryValues,
} from '@/shared/db/pg/effect/org-projector'
import {
  SUBSCRIPTION_PLAN_COLUMNS,
  subscriptionPlanColumnValues,
} from '@/shared/db/pg/effect/subscription-plan-projector'
import {
  SUBSCRIPTION_COLUMNS,
  subscriptionColumnValues,
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { UNIT_COLUMNS, unitColumnValues } from '@/shared/db/pg/effect/unit-projector'
import { upsertInvitePii, upsertMemberOperationPii } from '@/shared/db/pg/pii-sidecars-store'
import { upsertUnitsPii } from '@/shared/db/pg/units-pii-store'
import { getUserById, putUser } from '@/shared/db/pg/users-store'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { Schema } from 'effect'
import { createHash, randomBytes } from 'node:crypto'
import { parseJson } from './rest-json'

// Auth REST shapes.
const decodeSignUp = Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.String }))
const decodeIdToken = Schema.decodeUnknownSync(
  Schema.Struct({ idToken: Schema.optional(Schema.String) }),
)

function uniqueSuffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

// Seeds a profit Goal projection doc (brief 0042) directly via the emulator —
// the Copiloto surface reads the projection (`goals/{id}`), so the read-side
// E2E doesn't need the full event append. Doc id is deterministic per
// (type, unit, period), mirroring `defineGoal`.
export async function seedGoal(
  orgId: string,
  unitId: string,
  period: string,
  targetCents: number,
): Promise<void> {
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
  await seedGoalDoc(orgId, doc)
}

// User + Customer docs use the shared Test Data Builders `buildUser` /
// `buildStoredCustomer` (`@/shared/fixtures/domain-builders`), so the seed and the
// E2E helpers construct identical, strongly-typed domain docs (zero drift).

// Creates a fresh user, org, units, and (optional) memberOperations seeded
// directly into the Postgres event store. Returns the IDs + login material;
// pair with `signInAndAttachSession` to authenticate the browser context.
export async function seedOrg(input: SeedOrgInput = {}): Promise<SeededOrg> {
  const {
    slotMinutes = 15,
    hasBusinessHours = true,
    unitCount = 1,
    memberOperationCount = 1,
    memberOperationOperationalStatus = 'operational',
    selfBookingPublished = true,
    vertical = 'barbershop',
    cancellationPolicy,
    tier = 'advanced',
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

  // 2) Seed org + membership + user doc + units + memberOperations into the
  //    Postgres event store (event + typed projection per aggregate).
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

  const businessHours: BusinessHours = hasBusinessHours
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

  // Org doc. The Org is a pure folder (PRD Identidade v2) — no fiscal identity
  // (it lives on Unit.fiscal) and no agenda/self-booking config (moved to
  // Unit.agenda — context 3). Decoded as `StoredOrg`.
  const orgDoc: StoredOrg = {
    id: orgId,
    name: `E2E ${orgId}`,
    slug: `e2e-${orgId}`.toLowerCase(),
    vertical,
    ownerUserId: uid,
    // Mirror what createOrg writes (DEFAULT_* fills) so the doc is
    // schema-complete — the read boundary now decodes StoredOrg, so a partial
    // fixture (the old shape) fails validation.
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: now,
    updatedAt: now,
  }
  await seedOrgDoc(orgId, orgDoc)

  // Assinatura Oilio (brief 0072 gating). `free` writes no row (getOrgBilling
  // defaults a rowless org to Free); a paid tier seeds the row so the seeded org
  // keeps every capability the existing specs assume.
  if (tier !== 'free') {
    await seedOrgBilling(orgId, { tier, unitQuantity: unitCount })
  }

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
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  await seedMembershipDoc(ownerMembership)

  // User doc (currentOrgId pointer). #838: pre-fill the completion step
  // since seeded owners conceptually skipped OAuth + the live capture form.
  await putUserDoc(
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
      // Timezone is the establishment's now (moved from Org — context 3).
      timezone: 'America/Sao_Paulo',
      // Default to the appointment agenda so the unit drives the agenda
      // (unitUsesAgenda). The agenda page redirects to /orders when no unit
      // uses scheduling, which most specs depend on. The agenda-only configs
      // (slotMinutes/cancellationPolicy/templates/self-booking publish) live
      // ONLY in this appointment variant (moved from Org).
      agenda: {
        mode: 'appointment',
        businessHours,
        slotMinutes,
        cancellationPolicy: {
          enabled: cancellationPolicy?.enabled ?? false,
          minNoticeMinutes: cancellationPolicy?.minNoticeMinutes ?? 120,
        },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        selfBookingPublished,
        selfBookingPublishedAt: selfBookingPublished ? now : null,
      },
      // Uniform delete policy (brief 0027, #1041) — seeds match the new shape.
      archivedAt: null,
      // Born informal (no CNPJ) — formalization is an opt-in upgrade (0048).
      fiscal: { kind: 'informal' },
      createdAt: now,
      updatedAt: now,
    }
    await seedUnitDoc(orgId, unitId, unitDoc)
    // PII lives out of the unit projection (#1036 / ADR 0010): whatsapp/email
    // are stored in the `units_pii` sidecar table and merged at read time (the
    // PII contract — the typed projection has no PII columns). Mirror the product
    // write path so listings/details surface the contact channels.
    const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
    await upsertUnitsPii(orgId, unitId, unitPii)
  }

  // Post-D4 (#1226 AC-02) `operationalStatus` is DERIVED on read from whatsapp ∧
  // ≥1 unit ∧ ≥1 service. So an `operational` memberOperation needs a REAL service
  // linked in the `member_operation_services` join (brief 0068 D3) — not just
  // whatsapp + units. Seed one org service first (FK target must exist before the
  // join insert) and link it below. Named distinctly so it never collides with a
  // spec's own `'Corte'` assertion. Incomplete pros get none (they must derive
  // `incomplete`). Specs that drive incomplete→operational through the UI pass
  // `memberOperationOperationalStatus: 'incomplete'` to opt out.
  const operationalServiceId =
    memberOperationCount > 0 && memberOperationOperationalStatus !== 'incomplete'
      ? await seedService(orgId, {
          name: 'Serviço base',
          durationMinutes: 30,
          priceCents: 5000,
          publicVisible: true,
          unitIds: [...unitIds],
        })
      : null

  // Professionals — each linked to all units
  const memberOperationIds: string[] = []
  for (let i = 0; i < memberOperationCount; i++) {
    const pid = `e2e-prof-${uniqueSuffix()}`
    memberOperationIds.push(pid)
    const proUid = `e2e-prof-user-${pid}`
    // Identity source of truth (#1046 / brief 0028 AC-04/AC-05): the global
    // User doc. The read path merges name/whatsapp/email LIVE from here.
    //
    // `operationalStatus` is DERIVED on read (#1226 AC-02) from whatsapp ∧ ≥1
    // unit ∧ ≥1 service. The seed controls the whatsapp axis here: an
    // `incomplete` memberOperation is seeded WITHOUT whatsapp (so the derive floors
    // at incomplete); an `operational` one has whatsapp + ≥1 unit (below) and
    // expects the spec to attach ≥1 service via `linkMemberOperationToServices`.
    const wantsOperational = memberOperationOperationalStatus !== 'incomplete'
    await putUserDoc(
      buildUser(proUid, now, {
        email: `prof-${i + 1}-${pid}@e2e.local`,
        displayName: `Profissional ${i + 1}`,
        emailVerified: true,
        currentOrgId: orgId,
        ...(wantsOperational ? { whatsapp: '5511900000000', completionCompleted: true } : {}),
        claimedAt: now,
      }),
    )
    // MemberOperation projection — decoded as `StoredMemberOperation` (omits the PII
    // name/whatsapp/email/taxIdentity, merged from `users/` + `member_operations_pii`,
    // and `operationalStatus`, derived on read — #1226 AC-02).
    const proDoc: StoredMemberOperation = {
      id: pid,
      orgId,
      // Non-null userId (#1045 / brief 0028 AC-01) — seeded fixtures honor
      // the same invariant as the product code: no MemberOperation without a
      // linked User. Synthetic uid per memberOperation, unique per seed run.
      userId: proUid,
      defaultCommission: null,
      unitIds: [...unitIds],
      // Link the org service so the derive (#1226 AC-02) flips to `operational`;
      // `seedMemberOperationDoc` mirrors this into `member_operation_services` (D3) in-tx.
      catalogServiceIds: operationalServiceId ? [operationalServiceId] : [],
      createdAt: now,
      updatedAt: now,
    }
    // Membership(role=memberOperation) for the seeded memberOperation (brief 0037
    // #1085): the MemberOperation projection is the operational view of a member,
    // so the fixture honors the invariant projeção ⟺ membro role=memberOperation.
    // This makes the pro show up in `/team` and its member detail navigable at
    // `/team/{proUid}`. Permissions = the memberOperation default.
    //
    // Seeded BEFORE the memberOperation doc: the operational profile hangs off the
    // membership via the composite FK `(org_id, member_id) → memberships`
    // (brief 0076 AC-02), and these are separate (autocommit) seed txs, so the
    // membership parent must exist when the memberOperation row commits.
    const proMembershipId = `${orgId}_${proUid}`
    const proMembership: Membership = {
      id: proMembershipId,
      orgId,
      userId: proUid,
      role: 'member_operator',
      status: 'active',
      invitedBy: uid,
      joinedAt: now,
      updatedAt: now,
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('member_operator'),
    }
    await seedMembershipDoc(proMembership)
    await seedMemberOperationDoc(orgId, proDoc)
    // Per-org PII (#1036, ADR 0010) — after #1046 only `taxIdentity`.
    // Identity (name/whatsapp/email) lives on the global User (read live).
    const proPii: MemberOperationPii = { taxIdentity: null }
    await upsertMemberOperationPii({ orgId, id: pid, taxIdentity: proPii.taxIdentity })
  }

  return { uid, email, password, orgId, unitIds, memberOperationIds }
}

// Pins an existing membership to a single unit (brief 0029, AC-05). Mirrors
// what `membership.rlsUnitScope` does in product code: the member is locked to
// that unit (no selector, no cross-unit access). Uses an updateMask so only
// `rls_unit_scope` is patched (the emulator otherwise replaces the whole doc).
// Patches the membership `role` (brief 0029, AC-08). Lets a spec demote the
// seeded owner to e.g. `receptionist` so the role-filtered nav can be
// asserted. Uses an updateMask so only `role` is patched.
// The `memberships` PK is composite `(org_id, id)` (D6), but the membership `id`
// (`${orgId}_${userId}`) is globally unique on its own — so a read keyed only by
// `id` (the caller doesn't carry the orgId) is unambiguous. Returns the typed row
// or null.
async function readMembershipRowById(membershipId: string): Promise<MembershipRow | null> {
  const rows = await pgQueryProjection('memberships', 'id', membershipId)
  const row = rows[0]
  return row ? Schema.decodeUnknownSync(MembershipRowSchema)(row) : null
}

async function readMembershipDoc(membershipId: string): Promise<Membership> {
  const row = await readMembershipRowById(membershipId)
  if (!row) throw new Error(`setMembership*: membership ${membershipId} not found`)
  return Schema.decodeUnknownSync(MembershipSchema)(membershipRowToDoc(row))
}

export async function setMembershipRole(membershipId: string, role: string): Promise<void> {
  const current = await readMembershipDoc(membershipId)
  const next: Membership = { ...current, role: Schema.decodeUnknownSync(RoleSchema)(role) }
  const ref = aggregateRef(MembershipConfig, next.orgId, membershipId)
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'membership.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBERSHIP_COLUMNS,
    valuesAt: (v) => membershipColumnValues(next, ref, v),
    table: 'memberships',
  })
}

// Flips a seeded subscription's `status` in place (updateMask PATCH). Used by
// the close-dialog E2E to simulate a subscription cancelled in another session
// AFTER an item was marked as plan-consumption — so `closeOrder` re-queries the
// active subscription, finds none, and rejects inline (the AC-03 contract).
export async function setSubscriptionStatus(
  orgId: string,
  subscriptionId: string,
  status: 'pending' | 'active' | 'past_due' | 'suspended' | 'cancelled',
): Promise<void> {
  const ref = aggregateRef(SubscriptionConfig, orgId, subscriptionId)
  const row = await readProjectionRow<SubscriptionRow>('subscriptions', ref)
  if (!row) throw new Error(`setSubscriptionStatus: subscription ${subscriptionId} not found`)
  const current = Schema.decodeUnknownSync(SubscriptionSchema)(subscriptionRowToDoc(row))
  const next: Subscription = { ...current, status }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'subscription.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: SUBSCRIPTION_COLUMNS,
    valuesAt: (v) => subscriptionColumnValues(next, v),
    table: 'subscriptions',
  })
}

export async function setMembershipUnitId(
  membershipId: string,
  unitId: string | null,
): Promise<void> {
  const current = await readMembershipDoc(membershipId)
  const next: Membership = { ...current, rlsUnitScope: unitId }
  const ref = aggregateRef(MembershipConfig, next.orgId, membershipId)
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'membership.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBERSHIP_COLUMNS,
    valuesAt: (v) => membershipColumnValues(next, ref, v),
    table: 'memberships',
  })
}

// Seeds an EXTRA active member into an existing org (brief 0030, AC-04/05):
// a User doc (live identity) + an active Membership with the given role. By
// design it does NOT create a MemberOperation projection — so a `receptionist`
// seeded here has no approved MemberOperation, which is exactly the case AC-05
// must unblock (a non-memberOperation member can be attributed to a product/
// standalone item and the sale closes). Returns the member's global `userId`.
export async function seedMember(
  orgId: string,
  opts: {
    role: 'manager' | 'member_operator' | 'receptionist'
    displayName: string
    unitId?: string | null
  },
): Promise<{ userId: string }> {
  const userId = `e2e-member-${uniqueSuffix()}`
  const now = new Date().toISOString()
  await putUserDoc(
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
  // Custom permission set (not the role default): a non-memberOperation member that
  // can manage customers + appointments — the AC-05 case (brief 0030).
  const permissions: MembershipPermissions = {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageCatalog: false,
    canManageOperators: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
    canBeBooked: false,
    canEarnCommission: false,
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
    rlsUnitScope: opts.unitId ?? null,
    permissions,
  }
  await seedMembershipDoc(membership)
  return { userId }
}

// Seeds a COMPLETE active Membership for an ALREADY-EXISTING user (`userId`)
// without touching the global `users/{userId}` doc. Use when the member is an
// auth user created elsewhere (e.g. `seedAuthUser`) that must keep its login
// identity intact — unlike `seedMember`, which provisions its own user. Role
// permissions default to `defaultPermissionsForRole(role)`; pass `unitId` to
// scope the membership to a single unit. Returns the membership doc id.
export async function seedMembershipFor(
  orgId: string,
  userId: string,
  opts: { role: Role; unitId?: string | null },
): Promise<string> {
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
    rlsUnitScope: opts.unitId ?? null,
    permissions: defaultPermissionsForRole(opts.role),
  }
  await seedMembershipDoc(membership)
  return membershipId
}

// Seeds a LOGINABLE memberOperation in an existing org (brief 0075, #1253): a real
// Firebase Auth user (so the spec can sign in AS the memberOperation) linked to a
// `member_operations` projection + a `memberOperation`-role membership + PII. Unlike
// the synthetic `e2e-prof-user-*` seeded by `seedOrg`, this user can mint a
// session — needed to prove own-scope (RLS + capability gates) from the
// memberOperation's own session. Operational (whatsapp + units + services) so it
// is bookable on the agenda. Returns the auth credentials + projection id.
export async function seedLoginableMemberOperation(
  orgId: string,
  opts: { unitIds: string[]; catalogServiceIds?: string[]; displayName?: string },
): Promise<{ uid: string; email: string; password: string; memberOperationId: string }> {
  const auth = await seedAuthUser()
  const now = new Date().toISOString()
  const memberOperationId = `e2e-prof-${uniqueSuffix()}`

  // Refresh the global User doc to carry whatsapp + currentOrgId so the
  // operational-status derive (#1226 AC-02) floors at operational and the app
  // resolves this org on login.
  await putUserDoc(
    buildUser(auth.uid, now, {
      email: auth.email,
      displayName: opts.displayName ?? 'E2E Profissional',
      emailVerified: true,
      currentOrgId: orgId,
      whatsapp: '5511900000001',
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )

  const proDoc: StoredMemberOperation = {
    id: memberOperationId,
    orgId,
    userId: auth.uid,
    defaultCommission: null,
    unitIds: [...opts.unitIds],
    catalogServiceIds: [...(opts.catalogServiceIds ?? [])],
    createdAt: now,
    updatedAt: now,
  }
  // Membership seeded BEFORE the memberOperation doc — the operational profile hangs
  // off the membership via the composite FK (brief 0076 AC-02), and these are
  // separate (autocommit) seed txs.
  const membership: Membership = {
    id: membershipDocId(orgId, auth.uid),
    orgId,
    userId: auth.uid,
    role: 'member_operator',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('member_operator'),
  }
  await seedMembershipDoc(membership)
  await seedMemberOperationDoc(orgId, proDoc)
  await upsertMemberOperationPii({ orgId, id: memberOperationId, taxIdentity: null })

  return { ...auth, memberOperationId }
}

// Seeds a loginable member with a `member_operator` membership (default preset:
// `canBeBooked` true, `canManageCustomers` false → own-scoped, NOT front-desk)
// but DELIBERATELY NO `member_operations` projection row — the degraded
// fail-closed state of brief 0076/#1268 (onboarding incomplete / projection lag
// after invite-accept). `resolveMemberOperationScope` then returns the sentinel,
// so the agenda surfaces the explicit empty-state instead of a mute blank grid.
// Mirrors `seedLoginableMemberOperation` minus the projection + PII writes.
export async function seedLoginableMemberWithoutProfile(
  orgId: string,
  opts: { displayName?: string } = {},
): Promise<{ uid: string; email: string; password: string }> {
  const auth = await seedAuthUser()
  const now = new Date().toISOString()
  await putUserDoc(
    buildUser(auth.uid, now, {
      email: auth.email,
      displayName: opts.displayName ?? 'E2E Sem Perfil',
      emailVerified: true,
      currentOrgId: orgId,
      whatsapp: '5511900000002',
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )
  const membership: Membership = {
    id: membershipDocId(orgId, auth.uid),
    orgId,
    userId: auth.uid,
    role: 'member_operator',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('member_operator'),
  }
  await seedMembershipDoc(membership)
  // No seedMemberOperationDoc / PII — the projection is absent ON PURPOSE.
  return auth
}

// Seeds a second org + units + an owner membership for an EXISTING user
// (brief 0029, AC-09). Use after `seedOrg` to give the seeded owner a
// membership in two orgs so the org switcher shows. Does NOT touch the
// user's `currentOrgId` (the spec switches via the UI). Returns the new
// org + unit ids.
export async function seedAdditionalOrg(
  uid: string,
  opts: { name?: string; unitCount?: number } = {},
): Promise<{ orgId: string; unitIds: string[] }> {
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
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: now,
    updatedAt: now,
  }
  await seedOrgDoc(orgId, orgDoc)

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
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  await seedMembershipDoc(membership)

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
      timezone: 'America/Sao_Paulo',
      // Appointment agenda (unpublished) — agenda-only configs live here only.
      agenda: {
        mode: 'appointment',
        businessHours: EMPTY_BUSINESS_HOURS,
        slotMinutes: 15,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        selfBookingPublished: false,
        selfBookingPublishedAt: null,
      },
      archivedAt: null,
      fiscal: { kind: 'informal' },
      createdAt: now,
      updatedAt: now,
    }
    await seedUnitDoc(orgId, unitId, unitDoc)
    // PII out of the unit projection (#1036 / ADR 0010) — mirror the product
    // write path so reads merge whatsapp/email from `units_pii/{id}`.
    const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
    await upsertUnitsPii(orgId, unitId, unitPii)
  }

  return { orgId, unitIds }
}

// ----------------------------------------------------------------------------
// Per-entity seeds — call after `seedOrg` for fixtures the spec needs.
// ----------------------------------------------------------------------------

export type SeedAppointmentInput = {
  orgId: string
  unitId: string
  memberOperationId: string
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

// The Customer → User FK, read off the `customers` projection in Postgres (the
// event store, post-cutover). Used by the seeds (appointment/subscription) to
// denormalize `customerUserId` for the cross-org /me queries.
async function readCustomerUserId(orgId: string, customerId: string): Promise<string> {
  const row = await pgReadProjection('customers', aggregateRef(CustomerConfig, orgId, customerId))
  const uid = row?.user_id
  if (typeof uid !== 'string' || !uid) {
    throw new Error(`seedAppointment: customer ${customerId} has no userId`)
  }
  return uid
}

// The first real unit id of an org, read off the `units` projection. Seeds that
// reference a parent unit derive it from the org's actual units instead of a
// magic-string literal — the FK (`*_unit_id_fk`) rejects an orphan id (#1220 D2).
async function firstUnitIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('units', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstUnitIdForOrg: org ${orgId} has no unit projection`)
  }
  return id
}

// The first real subscription id of an org (optionally scoped to a unit), read
// off the `subscriptions` projection. Charge seeds derive their parent
// subscription from a real row instead of a magic-string literal (FK
// `charges_subscription_id_fk` is NOT NULL + RESTRICT, #1220 D2). When `unitId`
// is given, prefers a subscription owned by that unit so the charge's billing
// record stays consistent with its unit scope.
async function firstSubscriptionIdForOrg(orgId: string, unitId?: string): Promise<string> {
  const rows = await pgQueryProjection('subscriptions', 'org_id', orgId)
  const row = unitId ? (rows.find((r) => r.unit_id === unitId) ?? rows[0]) : rows[0]
  const id = row?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(
      `firstSubscriptionIdForOrg: org ${orgId}${unitId ? ` unit ${unitId}` : ''} has no subscription projection`,
    )
  }
  return id
}

// The first real customer id of an org, read off the `customers` projection.
// Charge seeds derive their parent customer from a real row instead of a
// magic-string literal (FK `charges_customer_id_fk`, #1220 D2).
async function firstCustomerIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('customers', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstCustomerIdForOrg: org ${orgId} has no customer projection`)
  }
  return id
}

// The first real order id of an org, read off the `orders` projection. The cash
// movement seed derives its parent order from a real row instead of a
// magic-string literal (FK `cash_movements_order_id_fk`, #1220 D2).
async function firstOrderIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('orders', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstOrderIdForOrg: org ${orgId} has no order projection`)
  }
  return id
}

// The MemberOperation → User link off the `member_operations` projection; null when the
// memberOperation has no linked user (or no projection).
async function readMemberOperationUserId(
  orgId: string,
  memberOperationId: string,
): Promise<string | null> {
  const row = await pgReadProjection(
    'member_operations',
    aggregateRef(MemberOperationConfig, orgId, memberOperationId),
  )
  const uid = row?.user_id
  return typeof uid === 'string' && uid ? uid : null
}

// A raw `timestamptz` cell read off a `SELECT *` projection row: the pg driver
// hands these back as a `Date` (brief 0068 D1), but a typed-as-string projection
// historically saw an ISO string. Accept either and normalize to ISO so the
// decoded row keeps the `MemberOperationRow.created_at: string` shape the projector's
// `rowToDoc` consumes — the row-schema is intermediate; the domain decode happens
// downstream on already-ISO strings.
const TimestamptzRowCell = Schema.transform(
  Schema.Union(Schema.String, Schema.DateFromSelf),
  Schema.String,
  {
    strict: true,
    decode: (value) => (value instanceof Date ? value.toISOString() : value),
    encode: (value) => value,
  },
)

// Row Schema for the `member_operations` projection — decodes a raw `pgQueryProjection`
// record (snake_case, `unknown` values) into the typed `MemberOperationRow` WITHOUT
// an unsafe cast, so `memberOperationRowToDoc` can map it. Mirrors the projector's
// `MemberOperationRow` shape (`operational_status` dropped — #1226 AC-02).
const MemberOperationRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  last_event_version: Schema.Union(Schema.String, Schema.Number),
  user_id: Schema.String,
  member_id: Schema.String,
  default_commission: Schema.Unknown,
  unit_ids: Schema.Unknown,
  catalog_service_ids: Schema.Unknown,
  created_at: TimestamptzRowCell,
  updated_at: TimestamptzRowCell,
})

// Row Schema for the `memberships` projection — decodes a raw `pgQueryProjection`
// record into the typed `MembershipRow` WITHOUT an unsafe cast (the `id`-only read
// uses `pgQueryProjection`, whose rows are `unknown`-valued). Mirrors the
// projector's `MembershipRow` shape; the projection version column is
// `last_event_version` (D6).
const MembershipRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  user_id: Schema.String,
  last_event_version: Schema.Union(Schema.String, Schema.Number),
  role: Schema.String,
  status: Schema.String,
  rls_unit_scope: Schema.Union(Schema.String, Schema.Null),
  invited_by: Schema.Union(Schema.String, Schema.Null),
  joined_at: TimestamptzRowCell,
  permissions: Schema.Unknown,
  updated_at: TimestamptzRowCell,
})

// Reads the MemberOperation projection linked to `userId` (≤1 per org) from
// Postgres. Returns the projection id + the DERIVED `operationalStatus` (#1226
// AC-02 — no longer a stored column), or null when no projection exists. Used by
// the role-edit lifecycle spec (#1086) to assert materialization (projection
// appears) and operability (status derives from whatsapp ∧ units ∧ services).
export type ReadMemberOperationResult = { id: string; operationalStatus: string }

export async function readMemberOperationByUserId(
  orgId: string,
  userId: string,
): Promise<ReadMemberOperationResult | null> {
  const rows = await pgQueryProjection('member_operations', 'user_id', userId)
  // Scope strictly to the requested org — a `?? rows[0]` fallback would leak a
  // memberOperation row from a DIFFERENT org when the user has none in this one,
  // defeating the `.toBeNull()` org-isolation asserts.
  const row = rows.find((r) => r.org_id === orgId) ?? null
  if (!row) return null
  // Decode the raw projection record (snake_case, `unknown` values) through the
  // row Schema so it becomes a typed `MemberOperationRow` WITHOUT an unsafe cast,
  // then map it to the domain doc + decode (mirrors the production read path).
  const typedRow = Schema.decodeUnknownSync(MemberOperationRowSchema)(row)
  const stored = Schema.decodeUnknownSync(StoredMemberOperationSchema)(
    memberOperationRowToDoc(typedRow),
  )
  // Derive on read exactly like the production read layer: the projection
  // existing ⇒ invite accepted; whatsapp comes from the linked global User.
  const user = await readUser(stored.userId)
  const whatsapp =
    user && 'whatsapp' in user && typeof user.whatsapp === 'string' ? user.whatsapp : null
  const operationalStatus = deriveOperationalStatus({
    inviteAccepted: true,
    whatsapp,
    unitIds: stored.unitIds,
    catalogServiceIds: stored.catalogServiceIds,
  })
  return { id: stored.id, operationalStatus }
}

// Ensures a `member_operations` projection exists for `memberOperationId` — appointments
// FK their member-operation (`appointments_member_operation_id_fk`, RESTRICT, #1220 D2),
// so a spec that references a placeholder memberOperation needs a real parent row.
// Seeds a minimal one (org-scoped, synthetic linked user) when absent. No-op
// when the row already exists, so callers passing a real id are untouched.
async function ensureMemberOperationExists(
  orgId: string,
  memberOperationId: string,
): Promise<void> {
  if (
    await pgProjectionExists(
      'member_operations',
      aggregateRef(MemberOperationConfig, orgId, memberOperationId),
    )
  )
    return
  const now = new Date().toISOString()
  const proUid = `e2e-prof-user-${memberOperationId}`
  // The operational profile hangs off the membership via the composite FK
  // (brief 0076 AC-02) — ensure the parent membership exists first (these are
  // separate seed txs, so ordering matters).
  const membershipId = membershipDocId(orgId, proUid)
  if (
    !(await pgProjectionExists('memberships', aggregateRef(MembershipConfig, orgId, membershipId)))
  ) {
    await seedMembershipDoc({
      id: membershipId,
      orgId,
      userId: proUid,
      role: 'member_operator',
      status: 'active',
      invitedBy: null,
      joinedAt: now,
      updatedAt: now,
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('member_operator'),
    })
  }
  const doc: StoredMemberOperation = {
    id: memberOperationId,
    orgId,
    userId: proUid,
    defaultCommission: null,
    unitIds: [],
    catalogServiceIds: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedMemberOperationDoc(orgId, doc)
}

// Ensures a kind-service `catalog_items` projection exists for `serviceId` —
// appointments FK their service (`appointments_service_id_fk`, RESTRICT, #1220
// D2), so a spec referencing a placeholder service needs a real parent row.
// Seeds a minimal one when absent; no-op when it already exists.
async function ensureServiceExists(orgId: string, serviceId: string): Promise<void> {
  if (await pgProjectionExists('catalog_items', aggregateRef(CatalogItemConfig, orgId, serviceId)))
    return
  const now = new Date().toISOString()
  const doc: CatalogServiceItem = {
    id: serviceId,
    orgId,
    kind: 'service',
    name: 'Corte',
    categoryId: null,
    priceCents: 5000,
    commission: null,
    unitIds: [],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: 30,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, serviceId, doc)
}

export async function seedAppointment(input: SeedAppointmentInput): Promise<string> {
  const id = `e2e-appt-${uniqueSuffix()}`
  const now = new Date().toISOString()
  // The appointment FKs its memberOperation + service (#1220 D2, RESTRICT) — ensure
  // both parent rows exist so a spec referencing a placeholder id doesn't trip
  // the constraint. No-op when the caller passes ids that already exist.
  await ensureMemberOperationExists(input.orgId, input.memberOperationId)
  await ensureServiceExists(input.orgId, input.serviceId)
  // Resolve the denormalized userId FKs at seed time so the doc matches
  // the new Appointment shape (#852 PR 4).
  const customerUserId = await readCustomerUserId(input.orgId, input.customerId)
  const memberOperatorUserId = await readMemberOperationUserId(input.orgId, input.memberOperationId)
  const doc: Appointment = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    memberOperationId: input.memberOperationId,
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
    memberOperatorUserId,
    createdAt: now,
    updatedAt: now,
  }
  const ref = aggregateRef(AppointmentConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'appointment.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: APPOINTMENT_COLUMNS,
    values: appointmentColumnValues(doc, ref, 1),
    table: 'appointments',
  })
  return id
}

// Seeds the Customer + User stub pair the new schema requires (#852 PR 3).
// PII lives on the global User; the per-org Customer is operational only
// and references the User by FK.
export async function seedCustomer(
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
): Promise<string> {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const userId = opts.userId ?? `e2e-user-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? `Cliente ${customerId.slice(-4)}`

  // User stub — owns the PII. Global `users` table (Postgres, post-cutover).
  await putUserDoc(
    buildUser(userId, now, {
      email: opts.email ?? null,
      displayName: name,
      avatarUrl: opts.avatarUrl ?? null,
      whatsapp: opts.whatsapp ?? null,
    }),
  )

  // Per-org Customer shadow. Decoded as `StoredCustomer` (omits the PII
  // name/whatsapp/email/birthDate/avatarUrl, merged from `users/`).
  const customerDoc: StoredCustomer = buildStoredCustomer(customerId, orgId, userId, now)
  await seedCustomerDoc(orgId, customerDoc)
  // Reverse-index link (`org_links`) — the create-customer saga writes this in
  // production (linkCustomerOrg). Without it `listLinkedOrgIds(uid)` is empty, so
  // /me/{appointments,subscriptions} and the OAuth merge can't discover the org.
  await seedOrgLink(userId, orgId)
  return customerId
}

// Seeds ONLY the per-org Customer shadow for an ALREADY-EXISTING user
// (`userId`), without touching the global `users/{userId}` doc. Use this when
// the subject is also an owner/member with a complete user doc that
// `seedCustomer` would otherwise clobber (resetting `completionCompleted`).
// Returns the customer id.
export async function seedCustomerShadowForUser(orgId: string, userId: string): Promise<string> {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const now = new Date().toISOString()
  await seedCustomerDoc(orgId, buildStoredCustomer(customerId, orgId, userId, now))
  // Reverse-index link — see seedCustomer (the create-customer saga writes it).
  await seedOrgLink(userId, orgId)
  return customerId
}

// True when `userId` is blocked as a CUSTOMER in `orgId`. Post-cutover the block
// is no longer a `blocked_subjects` marker — it is the materialized `archived_at`
// on the customer shadow (brief 0062 / `block-subject-in-org.ts`). So the marker
// "exists" iff the org has an archived customer row for this user.
export async function blockedSubjectMarkerExists(orgId: string, userId: string): Promise<boolean> {
  const rows = await pgQueryProjection('customers', 'user_id', userId)
  return rows.some((r) => r.org_id === orgId && r.archived_at !== null)
}

// Seeds a reverse-index link `org_links(user_id, org_id)` — what the
// customer-creation saga (brief 0032 / #1097, AC-10) writes server-side. The
// privacy surface reads the subject's OWN links to discover where they are a
// customer. References only (zero PII): orgId + linkedAt.
export async function seedOrgLink(userId: string, orgId: string): Promise<void> {
  // Direct INSERT into the reverse-index table (the `org_links` PK is
  // [user_id, org_id]). We don't call `linkCustomerOrg` from
  // `@/shared/identity/org-links` because that module is `server-only` — pulling
  // it into the test helper (imported by every spec via fixtures) breaks the
  // Playwright/client bundle boundary. The seed writes the row the runtime
  // writer would, idempotently.
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `INSERT INTO org_links (user_id, org_id, linked_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userId, orgId, new Date().toISOString()],
    )
  } finally {
    await client.end()
  }
}

// Seed the Assinatura Oilio (org_billing) row for a Negócio (brief 0073/0074).
// A Negócio with no row is treated as Free by getOrgBilling, so specs that need
// the FREE baseline seed nothing; this helper is for the PAID case — it writes
// the row the Stripe webhook would, so gating/billing-surface E2E can assert the
// unlocked state without driving a real Stripe checkout. Direct INSERT (the
// projector/emitEvent path is `server-only`, can't cross the Playwright bundle
// boundary — same reason as seedOrgLink).
export async function seedOrgBilling(
  orgId: string,
  opts: {
    tier: 'pro' | 'advanced'
    billingCycle?: 'monthly' | 'annual'
    unitQuantity?: number
  },
): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const now = new Date().toISOString()
    await client.query(
      `INSERT INTO org_billing
         (org_id, id, last_event_version, tier, status, billing_cycle, unit_quantity,
          stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end,
          created_at, updated_at)
       VALUES ($1, $1, 1, $2, 'active', $3, $4, $5, $6, $7, false, $8, $8)
       ON CONFLICT (org_id) DO UPDATE SET
         tier = EXCLUDED.tier, status = EXCLUDED.status, billing_cycle = EXCLUDED.billing_cycle,
         unit_quantity = EXCLUDED.unit_quantity, updated_at = EXCLUDED.updated_at`,
      [
        orgId,
        opts.tier,
        opts.billingCycle ?? 'monthly',
        opts.unitQuantity ?? 1,
        `cus_seed_${orgId}`,
        `sub_seed_${orgId}`,
        // ~30 days out — capabilities hold through the period.
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        now,
      ],
    )
  } finally {
    await client.end()
  }
}

// Reads a reverse-index link row directly. Returns the row (org_id + linked_at,
// zero PII) or null when the link is absent. Used to assert the index holds zero
// PII / scoping.
export async function readOrgLink(
  userId: string,
  orgId: string,
): Promise<{ orgId: string; linkedAt: string } | null> {
  const rows = await pgQueryProjection('org_links', 'user_id', userId)
  const row = rows.find((r) => r.org_id === orgId)
  if (!row) return null
  // Map to the domain shape the spec asserts (`{ orgId, linkedAt }`) — the
  // reverse-index carries ONLY references, zero third-party PII. The `user_id`
  // PK column is the subject's OWN uid (not exposed here).
  return { orgId: String(row.org_id), linkedAt: String(row.linked_at) }
}

/**
 * Seeds a Subscription directly into the Postgres event store (skip create flow).
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

export async function seedSubscription(
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
    // Brief 0043 (#1117) — unidade dona da assinatura. Default: a primeira
    // unidade real da org (`firstUnitIdForOrg`); passe um id específico pra
    // exercitar o escopo por unidade (MRR/assinantes).
    unitId?: string
  } = {},
): Promise<string> {
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
  const customerUserId = await readCustomerUserId(orgId, customerId)
  // Derive the owning unit from a real `units` row when the caller doesn't pass
  // one — the FK rejects an orphan literal (#1220 D2).
  const unitId = opts.unitId ?? (await firstUnitIdForOrg(orgId))

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
    unitId,
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
  const ref = aggregateRef(SubscriptionConfig, orgId, subId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'subscription.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: SUBSCRIPTION_COLUMNS,
    values: subscriptionColumnValues(doc, 1),
    table: 'subscriptions',
  })
  return subId
}

// Brief 0042 (#1115), AC-08 — receita recorrente reconhecida. Semeia uma
// cobrança de assinatura JÁ liquidada (`status: paid`, `paidAt` na janela) pra
// uma unidade. O realizado do Copiloto soma essas cobranças; o MRR fica à parte.
export async function seedPaidCharge(
  orgId: string,
  opts: {
    unitId: string
    amountCents: number
    paidAt: string
    subscriptionId?: string
    customerId?: string
  },
): Promise<string> {
  const chargeId = `e2e-charge-${uniqueSuffix()}`
  const now = new Date().toISOString()
  // Derive parent subscription/customer from real projection rows when the
  // caller doesn't pass them — the FKs reject orphan literals (#1220 D2).
  const subscriptionId =
    opts.subscriptionId ?? (await firstSubscriptionIdForOrg(orgId, opts.unitId))
  const customerId = opts.customerId ?? (await firstCustomerIdForOrg(orgId))
  const doc: Charge = {
    id: chargeId,
    orgId,
    unitId: opts.unitId,
    subscriptionId,
    customerId,
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
  const ref = aggregateRef(ChargeConfig, orgId, chargeId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'charge.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CHARGE_COLUMNS,
    values: chargeColumnValues(doc, ref, 1),
    table: 'charges',
  })
  return chargeId
}

export async function seedService(
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
): Promise<string> {
  const id = `e2e-svc-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const commission = opts.commission ?? null
  const unitIds = [...(opts.unitIds ?? [])]
  // `CatalogServiceItem` per-unit override shape (`CatalogItemUnitOverride` —
  // every sub-field is `Schema.optional`). Build it as a typed record; absent
  // sub-fields stay omitted.
  const unitOverrides: CatalogServiceItem['unitOverrides'] = opts.unitOverrides
    ? Object.fromEntries(
        Object.entries(opts.unitOverrides).map(([uid, o]) => {
          const inner: { priceCents?: number; durationMinutes?: number } = {}
          if (o.priceCents !== undefined) inner.priceCents = o.priceCents
          if (o.durationMinutes !== undefined) inner.durationMinutes = o.durationMinutes
          return [uid, inner]
        }),
      )
    : null

  // Single catalog representation (brief 0023 #1004 → 0053/B3): agenda/booking/
  // order/public surfaces read `catalog_items` (decoded as `CatalogItem`). The
  // legacy `services/{id}` doc is gone — this seeds the kind-service catalog item
  // directly. `category` (free-text label) maps onto `categoryId`.
  const catalogDoc: CatalogServiceItem = {
    id,
    orgId,
    kind: 'service',
    name: opts.name ?? 'Corte',
    categoryId: opts.category ?? null,
    priceCents: opts.priceCents ?? 5000,
    commission,
    unitIds,
    unitOverrides,
    publicVisible: opts.publicVisible ?? false,
    priceVisibility: opts.priceVisibility ?? 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: opts.durationMinutes ?? 30,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, id, catalogDoc)
  return id
}

// Attaches a list of catalogServiceIds to an existing MemberOperation. Reads the
// current projection, sets the field, and re-projects via a `member_operation.updated`
// event in one tx (`mutateProjectionPostgres`) — so the other fields (`unitIds`,
// `operationalStatus`, …) are preserved, not wiped, and the memberOperation stays
// visible to the booking flow.
export async function linkMemberOperationToServices(
  orgId: string,
  memberOperationId: string,
  catalogServiceIds: string[],
): Promise<void> {
  const ref = aggregateRef(MemberOperationConfig, orgId, memberOperationId)
  const row = await readProjectionRow<MemberOperationRow>('member_operations', ref)
  if (!row)
    throw new Error(`linkMemberOperationToServices: memberOperation ${memberOperationId} not found`)
  const current = Schema.decodeUnknownSync(StoredMemberOperationSchema)(
    memberOperationRowToDoc(row),
  )
  const next: StoredMemberOperation = { ...current, catalogServiceIds: [...catalogServiceIds] }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'member_operation.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBER_OPERATION_COLUMNS,
    valuesAt: (v) => memberOperationColumnValues(next, v),
    table: 'member_operations',
    // Re-mirror the service N:N into `member_operation_services` in the same tx, as
    // the production projector does (brief 0068 D3): the public availability path
    // reads the join, not the JSONB array. Delete-then-insert keeps it idempotent.
    extraWrites: [
      { sql: MEMBER_OPERATION_SERVICES_DELETE, params: [orgId, memberOperationId] },
      ...memberOperationServiceRows(next).map((params) => ({
        sql: MEMBER_OPERATION_SERVICES_INSERT,
        params,
      })),
    ],
  })
}

export async function seedProduct(
  orgId: string,
  opts: { name?: string; priceCents?: number; stock?: number; sku?: string } = {},
): Promise<string> {
  const id = `e2e-prod-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? 'Pomada'
  const priceCents = opts.priceCents ?? 3000
  const stock = opts.stock ?? 100
  const sku = opts.sku ?? null
  // Single catalog representation (brief 0023 #1004 → 0053/B3): order close
  // resolves products from `catalog_items` (decoded as `CatalogItem`). The legacy
  // `products/{id}` doc is gone — this seeds the kind-product catalog item
  // directly. `unitIds` is empty here; the rule requires non-empty, but these
  // admin-surface writes bypass rules — and `resolveCatalogItemForUnit` reads the
  // base price when the unit has no override, so an empty unit scope still
  // resolves the order item correctly.
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
    gtin14: null,
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, id, catalogDoc)
  return id
}

// Seeds a unified CatalogItem (brief 0023) directly into the Postgres event
// store. Discriminated by `kind`; service-only / product-only fields are written
// conditionally. Used by the catalog baseline E2E (no CRUD UI yet — #1005).
export async function seedCatalogItem(
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
): Promise<string> {
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
          gtin14: null,
        }
  await seedCatalogItemDoc(orgId, id, doc)
  return id
}

// Seeds a Category doc (brief 0023, #1003) directly into the emulator (admin
// bypass). `CatalogItem.categoryId` / `SubscriptionPlan.includedCategoryIds`
// are FKs into this id. Returns the generated id.
export async function seedCategory(
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
): Promise<string> {
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
  await seedCategoryDoc(orgId, doc)
  return id
}

// Hard-deletes a Category projection row, exercising the real `catalog_items`
// → `categories` FK (`catalog_items_category_id_fk` ON DELETE SET NULL, #1220
// D2): items that pointed at the category get `category_id` nulled by the
// database, which is exactly the orphan state the "Sem categoria" UI proves.
// Seeding an item with a category_id that never existed would instead trip the
// FK on INSERT — the parent must exist first, then be removed.
export async function deleteCategory(orgId: string, categoryId: string): Promise<void> {
  await withEventStoreClient(async (q) => {
    // Composite PK `(org_id, id)` (D6) — `aggregate_path` no longer exists.
    await q(`DELETE FROM categories WHERE org_id = $1 AND id = $2`, [orgId, categoryId])
  })
}

// Seeds an extra Unit into an existing org (brief 0033, bug 3). Unlike the
// units created inside `seedOrg`, this lets a spec add a SECOND unit and,
// crucially, mark it `archivedAt` to assert that a soft-deleted unit drops out
// of the switcher and active-unit resolution. Mirrors the unit shape +
// `units_pii` write of `seedOrg`.
export async function seedUnit(
  orgId: string,
  opts: { name?: string; slug?: string; archivedAt?: string | null } = {},
): Promise<string> {
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
    timezone: 'America/Sao_Paulo',
    // Appointment agenda (unpublished) — agenda-only configs live here only.
    agenda: {
      mode: 'appointment',
      businessHours: EMPTY_BUSINESS_HOURS,
      slotMinutes: 15,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
      confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      selfBookingPublished: false,
      selfBookingPublishedAt: null,
    },
    archivedAt: opts.archivedAt ?? null,
    fiscal: { kind: 'informal' },
    createdAt: now,
    updatedAt: now,
  }
  await seedUnitDoc(orgId, id, unitDoc)
  const unitPii: UnitPii = { whatsapp: '5511900000000', email: null }
  await upsertUnitsPii(orgId, id, unitPii)
  return id
}

// Seeds a minimal SubscriptionPlan referencing category FK ids — used by the
// #1003 baseline to exercise the AC-05 in-use guard (a plan referencing the
// category must block its deletion).
export async function seedSubscriptionPlan(
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
): Promise<string> {
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
  await seedSubscriptionPlanDoc(orgId, doc)
  return id
}

// Reads a CatalogItem back from its Postgres projection, decoded to the domain
// `CatalogItem` doc; null when absent. Used by the consumer-migration specs to
// assert the item kind + frozen snapshots.
export async function readCatalogItem(
  orgId: string,
  catalogItemId: string,
): Promise<CatalogItem | null> {
  const row = await readProjectionRow<CatalogItemRow>(
    'catalog_items',
    aggregateRef(CatalogItemConfig, orgId, catalogItemId),
  )
  if (!row) return null
  return Schema.decodeUnknownSync(CatalogItemSchema)(catalogItemRowToDoc(row))
}

// Patches an existing Appointment's financial snapshot fields directly in the
// Postgres projection (admin bypass). Mirrors what `updateAppointment` writes
// when the owner swaps the booked service/unit (`appointment.updated` carrying
// servicePriceCentsSnapshot/commissionSnapshot). Used by the drift regression
// (#1037) to mutate the appointment AFTER its order exists, proving the order's
// value-copied snapshot does NOT follow.
//
// CRITICAL: PATCH must include `updateMask.fieldPaths` for each field so the
// emulator patches only those — without the mask it replaces the whole document.
export async function patchAppointmentSnapshot(
  orgId: string,
  appointmentId: string,
  snapshot: {
    servicePriceCentsSnapshot: number
    commissionSnapshot: { kind: 'percentage' | 'fixed'; value: number } | null
  },
): Promise<void> {
  const ref = aggregateRef(AppointmentConfig, orgId, appointmentId)
  const row = await readProjectionRow<AppointmentRow>('appointments', ref)
  if (!row) throw new Error(`patchAppointmentSnapshot: appointment ${appointmentId} not found`)
  const current = Schema.decodeUnknownSync(AppointmentSchema)(appointmentRowToDoc(row))
  const next: Appointment = {
    ...current,
    servicePriceCentsSnapshot: snapshot.servicePriceCentsSnapshot,
    commissionSnapshot: snapshot.commissionSnapshot,
  }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'appointment.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: APPOINTMENT_COLUMNS,
    valuesAt: (v) => appointmentColumnValues(next, ref, v),
    table: 'appointments',
  })
}

// Reads an Appointment back from its Postgres projection, decoded to the domain
// `Appointment` doc. Used by the consumer-migration spec (#1004) to assert the
// booking still references the catalog service id and froze the
// price/duration/commission snapshots. Returns null when absent.
export async function readAppointment(
  orgId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const row = await readProjectionRow<AppointmentRow>(
    'appointments',
    aggregateRef(AppointmentConfig, orgId, appointmentId),
  )
  if (!row) return null
  return Schema.decodeUnknownSync(AppointmentSchema)(appointmentRowToDoc(row))
}

// Lists appointment ids for an org — lets a spec find the doc a UI flow just
// created without knowing the generated id.
export async function listAppointmentIds(orgId: string): Promise<string[]> {
  const rows = await pgListByOrg('appointments', orgId)
  return rows.map((r) => (typeof r.id === 'string' ? r.id : '')).filter((id) => id !== '')
}

// True when the agenda-block projection still exists (offboarding cleanup
// assertion, brief 0041 AC-07).
export async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  return pgProjectionExists('agenda_blocks', aggregateRef(AgendaBlockConfig, orgId, blockId))
}

// Seeds an OPEN order/comanda with a single service item attributed to
// `attributedUserId` (the member's GLOBAL userId — brief 0030 AC-04). Used by
// the offboarding veto spec (brief 0041 AC-05): an open comanda attributed to a
// member refuses their removal until it's settled.
export async function seedOpenOrder(input: {
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
}): Promise<string> {
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
  const ref = aggregateRef(OrderConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'order.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORDER_COLUMNS,
    values: orderColumnValues(doc, ref, 1),
    table: 'orders',
  })
  return id
}

// Seed a CLOSED order for the active unit — counts as realizado avulso in the
// Copiloto read-model (status=closed + closedAt within the period window +
// unitId). `totalCents` drives the recognized revenue; the returned id links a
// commission against it (see `seedCommission({ orderId })`). Mirrors the open
// order seed but in its settled terminal state.
export async function seedClosedOrder(input: {
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
}): Promise<string> {
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
  const ref = aggregateRef(OrderConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'order.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORDER_COLUMNS,
    values: orderColumnValues(doc, ref, 1),
    table: 'orders',
  })
  return id
}

// Seed a commission attributed to a member (brief 0041 #1105 AC-06). Used to
// drive the pending-commission veto in the offboarding E2E. `liquidationStatus`
// defaults to `pendente` (the state that blocks removal).
export async function seedCommission(input: {
  orgId: string
  attributedUserId: string
  amountCents: number
  liquidationStatus?: 'pendente' | 'pago'
  // Link the commission to a real closed order so unit-scoped read-models that
  // map commission → order (e.g. the Copiloto realizado-após-comissão) pick it
  // up. Defaults to the org's first real order (FK `commissions_order_id_fk` is
  // NOT NULL + RESTRICT, #1220 D2 — an orphan literal is rejected).
  orderId?: string
  // Nome do item da comissão (default 'Corte'). Passe quando o teste assertar o
  // rótulo do item na lista de comissões (ex.: relatório/marcar-pago).
  itemName?: string
  // Nome do membro congelado no snapshot de retenção (default 'E2E Profissional').
  // Passe quando o teste assertar o nome identificável que sobrevive à remoção/
  // anonimização do membro.
  attributedMemberName?: string
}): Promise<string> {
  const id = `e2e-commission-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const status = input.liquidationStatus ?? 'pendente'
  // Derive the parent order from a real `orders` row when the caller doesn't
  // pass one — the FK is NOT NULL + RESTRICT (#1220 D2).
  const orderId = input.orderId ?? (await firstOrderIdForOrg(input.orgId))
  const doc: Commission = {
    id,
    orgId: input.orgId,
    orderId,
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
  const ref = aggregateRef(CommissionConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'commission.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: COMMISSION_COLUMNS,
    values: commissionColumnValues(doc, ref, 1),
    table: 'commissions',
  })
  return id
}

export type SeedBlockInput =
  | {
      kind: 'recurring'
      orgId: string
      unitId: string
      memberOperationId?: string | null
      weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
      open: string
      close: string
      reason: string
    }
  | {
      kind: 'one_off'
      orgId: string
      unitId: string
      memberOperationId?: string | null
      // ISO UTC.
      startAt: string
      endAt: string
      reason: string
    }

export async function seedBlock(input: SeedBlockInput): Promise<string> {
  const id = `e2e-block-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const base = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    memberOperationId: input.memberOperationId ?? null,
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
  await seedAgendaBlockDoc(input.orgId, doc)
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

  // #838: pre-seed the global user row with completionCompleted so the
  // invitee can hit /invites/... without bouncing through /onboarding/profile.
  // Defaults to true since most specs care about the post-completion world.
  // Pass `completionCompleted: false` to exercise the gate explicitly.
  const completionCompleted = opts.completionCompleted ?? true
  const now = new Date().toISOString()
  await putUserDoc(
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
  role: 'manager' | 'member_operator' | 'receptionist'
  invitedBy: string
  // Defaults to now + 7d. Pass a past ISO to seed an expired invite.
  expiresAt?: string
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
}

// Seeds an invite doc with a sha256-hashed token. Returns the inviteId and the
// raw token so the spec can build the accept URL.
export async function seedInvite(
  input: SeedInviteInput,
): Promise<{ inviteId: string; rawToken: string }> {
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
  await seedInviteDoc(input.orgId, inviteDoc)
  // The invitee email is PII (#1036, ADR 0010): it lives in the deletable
  // `invites_pii` sidecar table, NOT on the invite projection (merged at read
  // time, kept separate so erasure is a row delete). The product read path
  // (`getInviteById`) merges it from here — without it, `invite.email` reads as
  // '' and the accept-flow email match always fails. Mirrors `writeInvitePii`.
  const invitePii: InvitePii = { email: input.email }
  await upsertInvitePii({ orgId: input.orgId, id: inviteId, email: invitePii.email })
  return { inviteId, rawToken }
}

// Reads an invite's `status` off its Postgres projection; null when absent.
export async function readInviteStatus(orgId: string, inviteId: string): Promise<string | null> {
  const row = await readProjectionRow<InviteRow>(
    'invites',
    aggregateRef(InviteConfig, orgId, inviteId),
  )
  return row ? row.status : null
}

export async function readInvite(
  orgId: string,
  inviteId: string,
): Promise<{ status: string; acceptedByUid: string | null; acceptedAt: string | null } | null> {
  const row = await readProjectionRow<InviteRow>(
    'invites',
    aggregateRef(InviteConfig, orgId, inviteId),
  )
  if (!row) return null
  return {
    status: row.status,
    acceptedByUid: row.accepted_by_uid,
    // `accepted_at` is `timestamptz` (brief 0068 D1): the pg driver returns a
    // `Date` on this raw read. Normalize to ISO so callers see the same shape
    // production gets via the projector's `rowToDoc`.
    acceptedAt: row.accepted_at == null ? null : new Date(row.accepted_at).toISOString(),
  }
}

export type ReadMembershipResult = {
  orgId: string
  role: string
  status: string
  rlsUnitScope: string | null
  permissions: Record<string, boolean> | null
}

export async function readMembership(membershipId: string): Promise<ReadMembershipResult | null> {
  // Read keyed by `id` alone — the membership id is globally unique (it embeds the
  // orgId), so the composite-PK read is unambiguous without the caller's orgId.
  const row = await readMembershipRowById(membershipId)
  if (!row) return null
  // `membershipRowToDoc` re-projects the typed row to the domain doc (decodes
  // permissions jsonb). Decode through the domain schema so the shape matches
  // production reads.
  const doc = Schema.decodeUnknownSync(MembershipSchema)(membershipRowToDoc(row))
  return {
    orgId: doc.orgId,
    role: doc.role,
    status: doc.status,
    rlsUnitScope: doc.rlsUnitScope,
    permissions: doc.permissions,
  }
}

// Reads the global `users` row, decoded to the domain `User` doc; null when
// absent. The `users` table is keyed by the Firebase Auth uid.
export async function readUser(uid: string): Promise<User | null> {
  return getUserById(uid)
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
// interstitial showed, and leave the browser on the `/organizations` surface
// (Negócios & Unidades) so the caller can assert the created unit is there.
export async function enterUnitsAfterCreate(page: Page): Promise<void> {
  // The create action redirects to `/organizations` (the Negócios & Unidades
  // surface that absorbed the old `/units` list), but the `(app)` layout then
  // bounces a now-multi-unit org with no chosen unit to `/select-unit`. That
  // transient hop means we can't trust the immediate post-create URL — first let
  // the post-create navigation settle, then navigate to `/organizations`
  // ourselves and, if the interstitial shows, pin the first offered unit via the
  // cookie (more robust than the picker's async transition) and retry.
  // The create dialog opens OVER /organizations, so the URL doesn't change on
  // submit — waiting for a URL would resolve instantly against the starting
  // route and race our goto() against the still-pending Server Action (the
  // `useTransition` save), aborting the create. The deterministic "save
  // persisted" signal is the dialog closing (the action's redirect tears it
  // down). Wait for that BEFORE navigating.
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 })
  // Then let the post-create redirect fully settle before we navigate — racing
  // it with our own goto() makes the interstitial hop intermittent (flaky).
  await page.waitForURL(/\/(organizations|units|select-unit|agenda)$/, { timeout: 10000 })
  await page.goto('/organizations')
  if (/\/select-unit$/.test(new URL(page.url()).pathname)) {
    // The interstitial renders one submit button per unit; each carries its
    // unit id in the form `value` attribute (stable, accessible-query-safe).
    const unitId = await page
      .getByRole('button', { name: /Unidade/ })
      .first()
      .getAttribute('value')
    if (unitId) await setActiveUnitCookie(page.context(), unitId, page.url())
    await page.goto('/organizations')
  }
  await expect(page).toHaveURL(/\/organizations(\/|\?|$)/)
  // Wait for the Negócios surface to actually render (its heading is the stable
  // landmark) before returning — the caller asserts list contents right after,
  // and a not-yet-rendered list is the flake source. Web-first, no networkidle.
  await expect(page.getByRole('heading', { name: 'Negócios', level: 1 })).toBeVisible()
}

// ── Sovereign product base (Postgres) seeding (brief 0054) ───────────────────
//
// The autofill specs need a real `@cbrl/product` base behind the form. These
// helpers talk to Postgres directly (the runner — scripts/e2e-with-postgres.mjs
// locally, CI `services: postgres` — provides DATABASE_URL; globalSetup applies
// the migrations). `@cbrl/product` is imported lazily so specs that don't touch
// the base never load the pg pool.

// Seed a product into the sovereign base so a lookup of its GTIN is a HIT
// (Scenario 1). `source` defaults to 'official' to model a curated entry.
export async function seedProductBase(opts: {
  gtin14: string
  name?: string
  brand?: string | null
  source?: 'official' | 'external' | 'org-contributed'
}): Promise<void> {
  const { PostgresProductSource } = await import('@cbrl/product')
  await new PostgresProductSource().upsert({
    gtin14: opts.gtin14,
    name: opts.name ?? 'Produto Semeado',
    brand: opts.brand ?? null,
    source: opts.source ?? 'official',
  })
}

// Read a product back from the base by GTIN-14 — used to assert a miss
// auto-contributed (Scenario 2). Returns null when absent.
export async function readProductBase(
  gtin14: string,
): Promise<{ name: string; source: string } | null> {
  const { PostgresProductSource } = await import('@cbrl/product')
  const row = await new PostgresProductSource().findByGtin14(gtin14)
  return row === null ? null : { name: row.name, source: row.source }
}

// Clear ONLY a worker's own rows from the cross-org sovereign base between specs.
// The base has no orgId to isolate on, so a worker isolates by KEY: each derives
// a unique, GS1-valid GTIN namespace from its `parallelIndex` (see
// `helpers/sovereign-base.ts`). Deleting just those GTINs — never the whole table
// — lets base-touching specs run in PARALLEL without one worker's cleanup wiping
// a row another just seeded (the old `DELETE FROM product` did exactly that and
// flaked under CI's multi-worker e2e shards).
export async function deleteProductBaseForWorker(gtins: readonly string[]): Promise<void> {
  if (gtins.length === 0) return
  const { getDb, product } = await import('@cbrl/product')
  const { inArray } = await import('drizzle-orm')
  await getDb()
    .delete(product)
    .where(inArray(product.gtin14, [...gtins]))
}

// ── Catalog-item projection seeding, backend-aware (brief 0058) ──────────────
//
// The catalog seeds (seedService/seedProduct/seedCatalogItem) write a CatalogItem
// projection into the typed `catalog_items` table (plus a `created` event row for
// replay) or the app — reading Postgres — would never see the fixture. The runner
// (scripts/e2e-with-postgres.mjs / CI) provides OILIO_DATABASE_URL and applies the
// event-store migrations.
//
// Postgres is the ONLY backend after the cutover (#1202) — every fixture writes
// the event store in Postgres; there is no Firestore seed branch.

// Seed a CatalogItem projection into Postgres: the `created` event (version 1)
// plus the typed `catalog_items` row, in one transaction — the same shape the
// PostgresPersistenceLayer + typed projector write at runtime.
async function seedCatalogItemPostgres(orgId: string, id: string, doc: CatalogItem): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  const ref = aggregateRef(CatalogItemConfig, orgId, id)
  try {
    await client.query('BEGIN')
    // `aggregate_id` = bare id; `aggregate_type` (singular) + `org_id` are siblings (D6).
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        ref.type,
        ref.id,
        ref.orgId,
        {
          _tag: 'catalog_item.created',
          version: 1,
          timestamp: doc.createdAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: doc },
        },
      ],
    )
    // Same column list + value mapping the runtime projector uses (shared helper)
    // so a seeded row is byte-identical to a produced one and can never drift.
    const placeholders = CATALOG_ITEM_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO catalog_items (${CATALOG_ITEM_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      catalogItemColumnValues(doc, 1),
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

// Write a CatalogItem projection to the typed Postgres table.
async function seedCatalogItemDoc(orgId: string, id: string, doc: CatalogItem): Promise<void> {
  await seedCatalogItemPostgres(orgId, id, doc)
}

// ── Identity projection seeding (brief 0059) ─────────────────────────────────
//
// org/unit/membership seeds mirror the catalog-item pattern: the projection
// lives in the typed orgs/units/memberships table, so the seed writes the
// `created` event (version 1) + the typed row in one tx — the same shape the
// PostgresPersistenceLayer + typed projector write at runtime (shared column
// helpers, so a seed can't drift from production). The PII sidecars (`units_pii`)
// stay separate from the projection (the PII contract — merged at read time).

// Generic one-tx seed of an identity projection (event + typed row) into Postgres.
// `appointments`/`agenda_blocks` carry `member_id` (brief 0076 AC-04) DERIVED
// from the operational profile via a correlated subquery on `member_operation_id`
// — mirroring the runtime projectors. The `*_COLUMNS` lists (the placeholder
// values) omit it, so the seed/mutate helpers append the derived expression to
// the INSERT column list + VALUES (NOT a placeholder). For other tables the
// column list passes through unchanged.
function withDerivedMemberId(
  table: string,
  columns: readonly string[],
): { columnList: string; valueSuffix: string; conflictSet: string } {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  if (table !== 'appointments' && table !== 'agenda_blocks') {
    return {
      columnList: columns.join(', '),
      valueSuffix: placeholders,
      conflictSet: columns.map((col, i) => `${col} = $${i + 1}`).join(', '),
    }
  }
  const orgIdRef = `$${columns.indexOf('org_id') + 1}`
  const memberOpIdRef = `$${columns.indexOf('member_operation_id') + 1}`
  const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdRef} AND mo.id = ${memberOpIdRef})`
  return {
    columnList: [...columns, 'member_id'].join(', '),
    valueSuffix: `${placeholders}, ${memberIdDerived}`,
    conflictSet: [
      ...columns.map((col, i) => `${col} = $${i + 1}`),
      `member_id = ${memberIdDerived}`,
    ].join(', '),
  }
}

async function seedIdentityPostgres(args: {
  ref: AggregateRef
  createdTag: string
  data: unknown
  createdAt: string
  columns: readonly string[]
  values: readonly unknown[]
  table: string
  // Extra writes committed in the SAME tx as the event + projection. Used when a
  // single aggregate event materializes more than its own typed table — e.g. the
  // org projector also mirrors public fields into `public_org_directory`. Keeps
  // the seed faithful to the runtime projector (no drift, no missing directory).
  extraWrites?: readonly { sql: string; params: readonly unknown[] }[]
}): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    // `aggregate_id` is the bare aggregate id (D6); `aggregate_type` (singular,
    // from the config) + `org_id` are sibling columns → the event uniqueness is
    // `UNIQUE(aggregate_type, org_id, aggregate_id, version)`.
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        args.ref.type,
        args.ref.id,
        args.ref.orgId,
        {
          _tag: args.createdTag,
          version: 1,
          timestamp: args.createdAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: args.data },
        },
      ],
    )
    const { columnList, valueSuffix } = withDerivedMemberId(args.table, args.columns)
    await client.query(`INSERT INTO ${args.table} (${columnList}) VALUES (${valueSuffix})`, [
      ...args.values,
    ])
    for (const w of args.extraWrites ?? []) {
      await client.query(w.sql, [...w.params])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

// ── ES mutation (append next event + re-project) ─────────────────────────────
// A seed mutation under the event store is an APPEND of the next event version
// plus a re-projection of the aggregate to its new state — never a column poke.
// We re-project the WHOLE row (the same `*ColumnValues` the runtime projector
// writes) under `ON CONFLICT ... DO UPDATE`, so a mutated fixture can't drift
// from production. `last_event_version` is read from the projection row + bumped.
async function mutateProjectionPostgres(args: {
  ref: AggregateRef
  updatedTag: string
  data: unknown
  updatedAt: string
  columns: readonly string[]
  // Re-projects the full row at the bumped version.
  valuesAt: (version: number) => readonly unknown[]
  table: string
  // Extra writes applied in the SAME tx after the projection upsert — mirrors the
  // production projector, which rewrites derived join tables (brief 0068 D3) when
  // the aggregate's N:N arrays change. Delete-then-insert keeps them idempotent.
  extraWrites?: readonly { sql: string; params: readonly unknown[] }[]
}): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    // Projection PK is composite `(org_id, id)`; the projection version column is
    // `last_event_version` (D6). Read + bump it for the appended event.
    const cur = await client.query<{ last_event_version: number }>(
      `SELECT last_event_version FROM ${args.table} WHERE org_id = $1 AND id = $2`,
      [args.ref.orgId, args.ref.id],
    )
    const nextVersion = (cur.rows[0]?.last_event_version ?? 1) + 1
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        args.ref.type,
        args.ref.id,
        nextVersion,
        args.ref.orgId,
        {
          _tag: args.updatedTag,
          version: nextVersion,
          timestamp: args.updatedAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: args.data },
        },
      ],
    )
    const values = args.valuesAt(nextVersion)
    const { columnList, valueSuffix, conflictSet } = withDerivedMemberId(args.table, args.columns)
    await client.query(
      `INSERT INTO ${args.table} (${columnList}) VALUES (${valueSuffix})
       ON CONFLICT (org_id, id) DO UPDATE SET ${conflictSet}`,
      [...values],
    )
    for (const w of args.extraWrites ?? []) {
      await client.query(w.sql, [...w.params])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

// ── Postgres read-back helpers (assert against the projection / stream) ───────
// Post-cutover the specs assert against Postgres, not the Firestore emulator.
// These centralize the patterns the specs inlined as FS_BASE+curl so a spec
// reads `await pgReadProjection('memberships', path)` instead of building SQL.

async function withEventStoreClient<T>(
  fn: (
    q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  ) => Promise<T>,
): Promise<T> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    return await fn((sql, params) => client.query(sql, params))
  } finally {
    await client.end()
  }
}

// Read one projection row by aggregate ref (composite PK `(org_id, id)`, D6);
// null when absent.
export async function pgReadProjection(
  table: string,
  ref: AggregateRef,
): Promise<Record<string, unknown> | null> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    return res.rows[0] ?? null
  })
}

// Existence probe by aggregate ref (composite PK `(org_id, id)`, D6).
export async function pgProjectionExists(table: string, ref: AggregateRef): Promise<boolean> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2 LIMIT 1`, [
      ref.orgId,
      ref.id,
    ])
    return res.rows.length > 0
  })
}

// Normalizes a raw `timestamptz` cell read from a projection row to an ISO
// string (or null). After brief 0068 D1 the pg driver hands these columns back
// as a `Date` on raw `SELECT *` reads (outside the projector's typed query), so
// specs that read a cell directly must normalize before asserting — mirrors the
// projectors' `rowToDoc`. Accepts the `unknown` cell shape `Record`-typed rows
// expose; a `Date` becomes ISO, an ISO string passes through, null/undefined
// become null.
export function timestamptzToIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  throw new TypeError(`timestamptzToIso: unexpected cell type ${typeof value}`)
}

// Rows of a typed projection filtered by an exact column match.
export async function pgQueryProjection(
  table: string,
  whereColumn: string,
  value: unknown,
): Promise<Record<string, unknown>[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE ${whereColumn} = $1`, [value])
    return res.rows
  })
}

// Every projection row for an org (the org-scoped list the specs paginate).
export async function pgListByOrg(
  table: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE org_id = $1`, [orgId])
    return res.rows
  })
}

// The aggregate's full event stream, ordered by version — the replay-assert
// surface (the stream is the proof). Returns the decoded `envelope` JSONB. Scoped
// by the composite event identity (`aggregate_type`, `org_id`, `aggregate_id`),
// the bare id (D6) — `aggregate_path` no longer exists.
export async function pgReadEventStream(ref: AggregateRef): Promise<unknown[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(
      `SELECT envelope FROM events
       WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3
       ORDER BY version ASC`,
      [ref.type, ref.orgId, ref.id],
    )
    return res.rows.map((r) => r.envelope)
  })
}

// Read a single typed projection row by aggregate path (e2e runs as superuser,
// so RLS is bypassed — the policies are proven in the isolation specs). Returns
// the raw row decoded only as far as the projector's `Row` shape; the caller
// passes it through `rowToDoc` + the domain schema for a fully typed doc.
async function readProjectionRow<Row extends Record<string, unknown>>(
  table: string,
  ref: AggregateRef,
): Promise<Row | null> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<Row>(`SELECT * FROM ${table} WHERE org_id = $1 AND id = $2`, [
      ref.orgId,
      ref.id,
    ])
    return res.rows[0] ?? null
  } finally {
    await client.end()
  }
}

// Write the global `users` row (the PII-owning identity doc) to Postgres. The
// `users` table is global (not org-scoped); `putUser` upserts it via the
// event-store pool.
async function putUserDoc(user: User): Promise<void> {
  await putUser(user)
}

// Write an Org projection (Postgres event store).
async function seedOrgDoc(orgId: string, doc: StoredOrg): Promise<void> {
  const ref = aggregateRef(OrgConfig, orgId, orgId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'org.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORG_COLUMNS,
    values: orgColumnValues(doc, 1),
    table: 'orgs',
    // The runtime org projector ALSO mirrors the public fields into
    // `public_org_directory` in the same tx — the public `/{slug}/{unit}` route
    // resolves through it. Reuse the projector's OWN upsert + values (single
    // source of truth) so the seed can never drift from production; without it
    // every public-page spec 404s.
    extraWrites: [{ sql: PUBLIC_DIRECTORY_UPSERT, params: publicOrgDirectoryValues(doc) }],
  })
}

// Write a Unit projection (StoredUnit — PII-omitted). The units_pii sidecar is
// written separately by the caller.
async function seedUnitDoc(orgId: string, unitId: string, doc: StoredUnit): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(UnitConfig, orgId, unitId),
    createdTag: 'unit.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: UNIT_COLUMNS,
    values: unitColumnValues(doc, 1),
    table: 'units',
  })
}

// Write a Membership projection.
async function seedMembershipDoc(membership: Membership): Promise<void> {
  const ref = aggregateRef(MembershipConfig, membership.orgId, membership.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'membership.created',
    data: membership,
    createdAt: membership.joinedAt,
    columns: MEMBERSHIP_COLUMNS,
    values: membershipColumnValues(membership, ref, 1),
    table: 'memberships',
  })
}

// ── Config projection seeding (brief 0060, Feature D) ─────────────────────────
// The 8 config aggregates mirror the identity pattern: the projection lives in
// its typed table, so the seed writes the `created` event (v1) + the typed row
// in one tx (shared column helpers — a seed can't drift from production). PII
// sidecars (member_operations_pii/invites_pii/units_pii) + the global `users` row
// are written separately by the caller via their Postgres stores (LGPD contract
// — merged at read time). The `data` passed is the PII-omitted `Stored*`/domain
// shape the `*ColumnValues` helper decodes.

async function seedMemberOperationDoc(orgId: string, doc: StoredMemberOperation): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(MemberOperationConfig, orgId, doc.id),
    createdTag: 'member_operation.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: MEMBER_OPERATION_COLUMNS,
    values: memberOperationColumnValues(doc, 1),
    table: 'member_operations',
    // Mirror the N:N arrays into the join tables in the same tx, exactly as the
    // production projector does (brief 0068 D3) — the public availability path
    // reads `member_operation_units`/`member_operation_services`, not the JSONB arrays.
    extraWrites: [
      ...memberOperationUnitRows(doc).map((params) => ({
        sql: MEMBER_OPERATION_UNITS_INSERT,
        params,
      })),
      ...memberOperationServiceRows(doc).map((params) => ({
        sql: MEMBER_OPERATION_SERVICES_INSERT,
        params,
      })),
    ],
  })
}

async function seedCustomerDoc(orgId: string, doc: StoredCustomer): Promise<void> {
  const ref = aggregateRef(CustomerConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'customer.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CUSTOMER_COLUMNS,
    values: customerColumnValues(doc, ref, 1),
    table: 'customers',
  })
}

async function seedInviteDoc(orgId: string, doc: StoredInvite): Promise<void> {
  const ref = aggregateRef(InviteConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'invite.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: INVITE_COLUMNS,
    values: inviteColumnValues(doc, ref, 1),
    table: 'invites',
  })
}

async function seedCategoryDoc(orgId: string, doc: Category): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(CategoryConfig, orgId, doc.id),
    createdTag: 'category.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CATEGORY_COLUMNS,
    values: categoryColumnValues(doc, 1),
    table: 'categories',
  })
}

async function seedSubscriptionPlanDoc(orgId: string, doc: SubscriptionPlan): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(SubscriptionPlanConfig, orgId, doc.id),
    createdTag: 'subscription_plan.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: SUBSCRIPTION_PLAN_COLUMNS,
    values: subscriptionPlanColumnValues(doc, 1),
    table: 'subscription_plans',
  })
}

async function seedAgendaBlockDoc(orgId: string, doc: AgendaBlock): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(AgendaBlockConfig, orgId, doc.id),
    createdTag: 'agenda_block.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: AGENDA_BLOCK_COLUMNS,
    values: agendaBlockColumnValues(doc, 1),
    table: 'agenda_blocks',
  })
}

async function seedGoalDoc(orgId: string, doc: Goal): Promise<void> {
  const ref = aggregateRef(GoalConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'goal.defined',
    data: doc,
    createdAt: doc.createdAt,
    columns: GOAL_COLUMNS,
    values: goalColumnValues(doc, ref, 1),
    table: 'goals',
  })
}

// Read-back of a catalog item by name for test assertions, from the typed
// Postgres `catalog_items` projection. Returns a plain `{ field: value }` record.
// `null` when no item matches.
export async function readCatalogItemByNameForAssert(
  orgId: string,
  name: string,
): Promise<{ name: string; categoryId: string | null; gtin14: string | null } | null> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<{
      name: string
      category_id: string | null
      gtin14: string | null
    }>('SELECT name, category_id, gtin14 FROM catalog_items WHERE org_id = $1 AND name = $2', [
      orgId,
      name,
    ])
    const row = res.rows[0]
    return row ? { name: row.name, categoryId: row.category_id, gtin14: row.gtin14 } : null
  } finally {
    await client.end()
  }
}

// Postgres is the only backend after the cutover (#1202), so a "skip on Postgres"
// is now an unconditional skip. Kept as a no-arg predicate so the few specs that
// still guard a Firestore-Security-Rules-specific assertion read unchanged; those
// asserts no longer apply and the guard always skips them.
export const skipOnPostgres = (): boolean => true
