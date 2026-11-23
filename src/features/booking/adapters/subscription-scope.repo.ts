import {
  mergeAllowedTimeScopes,
  mergeBookingLimits,
  remainingUsage,
  Subscription,
  type AllowedTimeScope,
  type BookingLimits,
  type SubscriptionCoverageEntry,
} from '@/domain'
import { getSessionUser } from '@/shared/auth/session'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getOrgBySlug } from '@/shared/org/org'
import { Schema } from 'effect'
import 'server-only'

const SCOPE_BEARING_STATUSES: Subscription['status'][] = ['active', 'past_due']

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function readScopeBearingSubscriptions(
  orgId: string,
  customerUserId: string,
): Promise<Subscription[]> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(
        'SELECT * FROM subscriptions WHERE org_id = $1 AND customer_user_id = $2 AND status = ANY($3)',
        [orgId, customerUserId, SCOPE_BEARING_STATUSES],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeSubscription(subscriptionRowToDoc(r)))
}

export type CustomerSubscriptionScope = {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  bookingLimits: BookingLimits | null
  includedCategoryIds: Set<string> | null
  coverage: SubscriptionCoverageEntry[]
}

type ScopeAcc = {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  timeScopeStarted: boolean
  bookingLimits: BookingLimits | null
  bookingLimitsStarted: boolean
  includedCategoryIds: Set<string> | null
  coverage: SubscriptionCoverageEntry[]
}

function foldSetAxis(
  current: Set<string> | null,
  ids: unknown,
  collapseOnEmpty: boolean,
): Set<string> | null {
  if (current === null) return null
  if (!Array.isArray(ids) || (collapseOnEmpty && ids.length === 0)) return null
  for (const id of ids) {
    if (typeof id === 'string') current.add(id)
  }
  return current
}

function foldScope(acc: ScopeAcc, sub: Subscription): ScopeAcc {
  acc.unitAllowlist = foldSetAxis(acc.unitAllowlist, sub.plan.unitAllowlist, false)

  const scope = sub.plan.allowedTimeScope ?? null
  acc.allowedTimeScope = acc.timeScopeStarted
    ? mergeAllowedTimeScopes(acc.allowedTimeScope, scope)
    : scope
  acc.timeScopeStarted = true

  const limits = sub.plan.bookingLimits ?? null
  acc.bookingLimits = acc.bookingLimitsStarted
    ? mergeBookingLimits(acc.bookingLimits, limits)
    : limits
  acc.bookingLimitsStarted = true

  acc.includedCategoryIds = foldSetAxis(acc.includedCategoryIds, sub.plan.includedCategoryIds, true)

  if (sub.status === 'active') {
    acc.coverage.push({
      includedItemIds: sub.plan.includedItemIds,
      includedCategoryIds: sub.plan.includedCategoryIds,
      remaining: remainingUsage(sub.currentPeriod.consumed, sub.plan.usageLimit),
    })
  }

  return acc
}

async function fetchCustomerScope(
  orgId: string,
  customerUserId: string,
): Promise<CustomerSubscriptionScope> {
  const subscriptions = await readScopeBearingSubscriptions(orgId, customerUserId)

  const acc: ScopeAcc = {
    unitAllowlist: new Set<string>(),
    allowedTimeScope: null,
    timeScopeStarted: false,
    bookingLimits: null,
    bookingLimitsStarted: false,
    includedCategoryIds: new Set<string>(),
    coverage: [],
  }

  if (subscriptions.length === 0) {
    return {
      unitAllowlist: null,
      allowedTimeScope: null,
      bookingLimits: null,
      includedCategoryIds: null,
      coverage: [],
    }
  }

  for (const sub of subscriptions) {
    foldScope(acc, sub)
  }

  return {
    unitAllowlist: acc.unitAllowlist,
    allowedTimeScope: acc.allowedTimeScope,
    bookingLimits: acc.bookingLimits,
    includedCategoryIds: acc.includedCategoryIds,
    coverage: acc.coverage,
  }
}

export async function resolveCustomerUnitAllowlist(
  orgId: string,
  customerUserId: string,
): Promise<Set<string> | null> {
  const { unitAllowlist } = await fetchCustomerScope(orgId, customerUserId)
  return unitAllowlist
}

export async function resolveCustomerSubscriptionScope(
  orgId: string,
  customerUserId: string,
): Promise<CustomerSubscriptionScope> {
  return fetchCustomerScope(orgId, customerUserId)
}

export async function resolveScopeForSession(
  orgId: string,
): Promise<CustomerSubscriptionScope | null> {
  const session = await getSessionUser()
  if (!session) return null
  return fetchCustomerScope(orgId, session.uid)
}

export async function resolveScopeForSessionBySlug(
  slug: string,
): Promise<CustomerSubscriptionScope | null> {
  const session = await getSessionUser()
  if (!session) return null
  const org = await getOrgBySlug(slug)
  if (!org) return null
  return fetchCustomerScope(org.id, session.uid)
}
