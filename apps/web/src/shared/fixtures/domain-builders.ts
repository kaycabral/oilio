// Shared Test Data Builders for the scheduling domain.
//
// Both data-creation fronts construct the same domain documents: the dev seed
// (`scripts/seed.ts`, persisted via the event-first path) and the E2E helpers
// (`tests/e2e/helpers/session.ts`, persisted via the Firestore REST emulator).
// The TRANSPORT and id strategy differ per front (and SHOULD — fixed/idempotent
// vs unique/isolated), so only the pure, strongly-typed OBJECT construction is
// shared here. A field added to a domain type breaks both fronts at compile time
// → zero drift. Each caller decides the id and how to persist.
//
// Pattern: Test Data Builders (override-based factory functions) — not Object
// Mother (named canned instances). Sensible defaults + a typed `Partial`
// override, so callers state only what matters to them.

import {
  type Appointment,
  type Charge,
  type Commission,
  type Invite,
  type Membership,
  type StoredCustomer,
  type Subscription,
  type SubscriptionPlanSnapshot,
  type User,
  defaultPermissionsForRole,
  membershipDocId,
} from '@/domain'

// Flat override surface: the common fields plus `completionCompleted`/mobile/
// birthDate kept loose so a caller can pass them dynamically. `buildUser` only
// builds LIVE (non-anonymized) accounts, so `anonymizedAt` is not overridable.
type BuildUserOverrides = Partial<
  Omit<User, 'completionCompleted' | 'mobile' | 'birthDate' | 'anonymizedAt'>
> & {
  completionCompleted?: boolean
  mobile?: string | null
  birthDate?: string | null
}

// A completed account REQUIRES a real mobile + birthDate (the `UserComplete`
// branch — see `domain/types/user.ts`). When a caller marks `completionCompleted`
// without supplying them, fall back to realistic placeholders rather than empty
// strings: an empty `birthDate`/`mobile` is a representable-but-fake "completed"
// account that turns illegal the moment a test nulls one axis (e.g. stripping
// mobile to simulate an incomplete pro), making the doc fail every union branch
// and crashing the strict-decoding read boundary.
const DEFAULT_COMPLETE_BIRTHDATE = '1990-01-01'

// The mobile is GLOBALLY unique (`users_mobile_unique`), so the default for a
// completed account MUST be unique per user — a fixed placeholder collided the
// moment a test (or seed) created two completed users. Derive a valid BR mobile
// from the uid so every fixture user gets its own number with no caller effort.
function defaultCompleteMobile(uid: string): string {
  let hash = 0
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0
  // 8 subscriber digits after the `9` (mobile), behind DDI 55 + DDD 11.
  return `55119${String(hash % 100_000_000).padStart(8, '0')}`
}

// Global identity doc (`users/{uid}`). Defaults are an unclaimed, incomplete
// account with no PII; override what the scenario needs. A completed account
// always carries a real mobile + birthDate so it stays a legal `UserComplete`.
export function buildUser(uid: string, now: string, overrides: BuildUserOverrides = {}): User {
  const { completionCompleted = false, mobile = null, birthDate = null, ...rest } = overrides
  const common = {
    uid,
    email: null,
    displayName: null,
    avatarUrl: null,
    emailVerified: false,
    currentOrgId: null,
    taxIdentity: null,
    bio: null,
    specialties: null,
    claimedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
    anonymizedAt: null,
  }
  return completionCompleted
    ? {
        ...common,
        completionCompleted: true,
        mobile: mobile ?? defaultCompleteMobile(uid),
        birthDate: birthDate ?? DEFAULT_COMPLETE_BIRTHDATE,
      }
    : { ...common, completionCompleted: false, mobile, birthDate }
}

// Per-org Customer shadow (`orgs/{tid}/customers/{id}`). PII lives on the
// User (referenced by `userId`); this projection is operational only.
export function buildStoredCustomer(
  id: string,
  orgId: string,
  userId: string,
  now: string,
): StoredCustomer {
  return {
    id,
    orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: now,
    updatedAt: now,
  }
}

// Frozen plan snapshot default — a free, unlimited-usage plan. Callers override
// `planId`/`name`/`includedItemIds` when coverage/identity matters.
const DEFAULT_PLAN_SNAPSHOT: SubscriptionPlanSnapshot = {
  planId: 'plan',
  name: 'Plano X',
  priceCents: 0,
  billingCycle: 'monthly',
  includedItemIds: [],
  includedCategoryIds: [],
  usageLimit: { kind: 'unlimited' },
}

type BuildSubscriptionOverrides = Partial<Omit<Subscription, 'plan'>> & {
  plan?: Partial<SubscriptionPlanSnapshot>
}

// Subscription read-model (`orgs/{tid}/subscriptions/{id}`). Defaults to an
// active, free subscription with a current period anchored at `now`. The
// `cancelledAt`-iff-cancelled invariant is honored automatically from `status`
// unless the caller overrides `cancelledAt` explicitly.
export function buildSubscription(
  id: string,
  orgId: string,
  now: string,
  overrides: BuildSubscriptionOverrides = {},
): Subscription {
  const { plan: planOverrides, ...rest } = overrides
  const status = rest.status ?? 'active'
  const cancelled = status === 'cancelled' || status === 'cancelled_for_non_payment'
  const base: Subscription = {
    id,
    orgId,
    unitId: 'unit',
    customerId: 'cust',
    customerUserId: null,
    plan: { ...DEFAULT_PLAN_SNAPSHOT, ...planOverrides },
    status,
    currentPeriod: { startAt: now, endAt: now, consumed: 0 },
    cancelAtPeriodEnd: false,
    nextChargeDate: null,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: cancelled ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...rest }
}

// Appointment read-model (`orgs/{tid}/appointments/{id}`). `customerUserId` is
// non-null by contract (collectionGroup bridge) — defaulted here so seeds never
// produce the illegal `null` the schema rejects.
export function buildAppointment(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<Appointment> = {},
): Appointment {
  const base: Appointment = {
    id,
    orgId,
    unitId: 'unit',
    memberOperationId: 'pro',
    customerId: 'cust',
    serviceId: 'svc',
    startAt: now,
    endAt: now,
    status: 'scheduled',
    servicePriceCentsSnapshot: 1000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'cust-user',
    memberOperatorUserId: null,
    attribution: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Subscription Charge (`orgs/{tid}/charges/{id}`). `paidAt` defaults from
// `status` (paid → `now`) for realism; override for other states.
export function buildCharge(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<Charge> = {},
): Charge {
  const status = overrides.status ?? 'scheduled'
  const base: Charge = {
    id,
    orgId,
    unitId: 'unit',
    subscriptionId: 'sub',
    customerId: 'cust',
    amountCents: 1000,
    periodStartAt: now,
    periodEndAt: now,
    dueDate: now,
    status,
    attempts: 0,
    paidAt: status === 'paid' ? now : null,
    failedAt: null,
    failureReason: null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Membership (`memberships/{orgId}_{userId}`). Doc id derives from the pair.
// Permissions default to the role's canonical set.
export function buildMembership(
  orgId: string,
  userId: string,
  now: string,
  overrides: Partial<Membership> = {},
): Membership {
  const role = overrides.role ?? 'member_operator'
  const base: Membership = {
    id: membershipDocId(orgId, userId),
    orgId,
    userId,
    role,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole(role),
  }
  return { ...base, ...overrides }
}

// Invite (`orgs/{tid}/invites/{id}`). The accepted-iff (`acceptedByUid`/
// `acceptedAt` present iff `status === 'accepted'`) invariant is honored from
// `status` unless the caller overrides those fields explicitly.
export function buildInvite(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<Invite> = {},
): Invite {
  const status = overrides.status ?? 'pending'
  const accepted = status === 'accepted'
  const base: Invite = {
    id,
    orgId,
    mobile: '5511990000000',
    role: 'member_operator',
    tokenHash: 'hash',
    expiresAt: now,
    status,
    invitedBy: 'owner',
    acceptedByUid: accepted ? 'accepted-uid' : null,
    acceptedAt: accepted ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Commission (`orgs/{tid}/commissions/{id}`). The paidAt-iff-paid invariant is
// honored from `liquidationStatus` unless `paidAt` is overridden explicitly.
export function buildCommission(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<Commission> = {},
): Commission {
  const liquidationStatus = overrides.liquidationStatus ?? 'pendente'
  const paid = liquidationStatus === 'pago'
  const base: Commission = {
    id,
    orgId,
    orderId: 'order',
    orderItemId: 'item',
    attributedUserId: 'user',
    attributedMemberName: 'Member',
    itemKind: 'service',
    itemName: 'Item',
    itemTotalCents: 2000,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: 1000,
    liquidationStatus,
    paidAt: paid ? now : null,
    paymentProof: null,
    createdAt: now,
  }
  return { ...base, ...overrides }
}
