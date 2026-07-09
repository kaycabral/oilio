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

type BuildUserOverrides = Partial<
  Omit<User, 'completionCompleted' | 'mobile' | 'birthDate' | 'anonymizedAt'>
> & {
  completionCompleted?: boolean
  mobile?: string | null
  birthDate?: string | null
}

const DEFAULT_COMPLETE_BIRTHDATE = '1990-01-01'

function defaultCompleteMobile(uid: string): string {
  let hash = 0
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0
  return `55119${String(hash % 100_000_000).padStart(8, '0')}`
}

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
    refundedAt: status === 'refunded' ? now : null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

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
