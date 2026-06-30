import {
  mergeAllowedTimeScopes,
  mergeBookingLimits,
  remainingUsage,
  Subscription,
  type AllowedTimeScope,
  type BookingLimits,
  type SubscriptionCoverageEntry,
} from '@/domain'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { getOrgBySlug } from '@/shared/org/org'
import { Schema } from 'effect'
import 'server-only'

// Statuses where the customer still has running coverage from a plan
// snapshot. `pending`/`suspended`/`cancelled` either never delivered
// coverage or already revoked it — they don't shape self-book scope.
const SCOPE_BEARING_STATUSES: Subscription['status'][] = ['active', 'past_due']

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// Reads the scope-bearing subscriptions for a customer (brief 0061 § Grupo B):
// the typed `subscriptions` projection under RLS, keyed off `customer_user_id`.
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

// Combined output of the scope-bearing subscription query — caller can
// inspect spatial (`unitAllowlist`) and temporal (`allowedTimeScope`)
// axes from a single Firestore read.
export type CustomerSubscriptionScope = {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  bookingLimits: BookingLimits | null
  // Category coverage (brief 0023, AC-04/AC-06 — #1004). Union of every
  // scope-bearing subscription's `plan.includedCategoryIds`. `null` means
  // "no category restriction" — either no scope-bearing subscription, or at
  // least one whose snapshot covers all categories (empty `includedCategoryIds`
  // = unrestricted, mirroring the avulso path). A non-null set restricts
  // self-book/agenda coverage to services whose `categoryId` ∈ the set.
  includedCategoryIds: Set<string> | null
  // Recognition layer (brief 0079, Grupo A — AC-01/AC-02). One entry per
  // scope-bearing subscription, carrying its frozen item/category coverage plus
  // the period balance (`remaining`). Additive to the gating axes above — the
  // wizard and the comanda derive "covered with balance" from this via
  // `isItemCoveredWithBalance`, while the `remaining` count stays internal
  // (decides badge/auto-mark presence, never rendered as a number — AC-02).
  // Empty for visitors with no scope-bearing subscription.
  coverage: SubscriptionCoverageEntry[]
}

// Mutable accumulator while folding the scope-bearing subscriptions. The
// `*Started` flags distinguish "no subscription seen yet" from "seen, merged
// to unrestricted (null)" for the merge-based axes.
type ScopeAcc = {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  timeScopeStarted: boolean
  bookingLimits: BookingLimits | null
  bookingLimitsStarted: boolean
  includedCategoryIds: Set<string> | null
  coverage: SubscriptionCoverageEntry[]
}

// Set-union axis (unitAllowlist / includedCategoryIds): union the ids, but any
// unrestricted snapshot collapses the whole axis to `null` (most permissive
// wins). `collapseOnEmpty` captures the one difference: an empty array means
// "covers everything" for categories but just an empty allowlist for units.
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
  // Spatial axis (Group A — AC-04).
  acc.unitAllowlist = foldSetAxis(acc.unitAllowlist, sub.plan.unitAllowlist, false)

  // Temporal axis (Group B — AC-04 extended). Same union semantics.
  const scope = sub.plan.allowedTimeScope ?? null
  acc.allowedTimeScope = acc.timeScopeStarted
    ? mergeAllowedTimeScopes(acc.allowedTimeScope, scope)
    : scope
  acc.timeScopeStarted = true

  // Behavioral axis (Group C — AC-11). "Most permissive wins" union.
  const limits = sub.plan.bookingLimits ?? null
  acc.bookingLimits = acc.bookingLimitsStarted
    ? mergeBookingLimits(acc.bookingLimits, limits)
    : limits
  acc.bookingLimitsStarted = true

  // Category coverage axis (brief 0023, AC-04/AC-06). Empty = covers everything.
  acc.includedCategoryIds = foldSetAxis(acc.includedCategoryIds, sub.plan.includedCategoryIds, true)

  // Recognition axis (brief 0079, Grupo A). Unlike the gating axes above, this
  // is collected per-subscription (no union): a covered item draws its balance
  // from the specific snapshot that covers it. `remaining` is `null` for an
  // unlimited plan (always has balance).
  //
  // ONLY `active` subscriptions feed recognition — the badge must agree with the
  // charge. The comanda auto-mark resolves coverage via the `active`-only
  // `loadActiveSubscriptionForCustomer`; a `past_due` plan (unpaid) does not pay
  // for the service, so badging it would promise coverage the close never
  // honors. Gating axes above intentionally still span `past_due` (shipped 0019
  // spatial/temporal scope) — recognition is the narrower, charge-aligned slice.
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

  // No early break: every scope-bearing subscription contributes a recognition
  // entry (brief 0079), even once the gating axes have collapsed to unrestricted.
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

/**
 * Computes the spatial scope a self-book session sees for a given
 * org — brief 0019 Group A (AC-03, AC-04).
 *
 * Returns:
 *   - `null` when the customer has no scope-bearing subscription in
 *     this org, or has one whose snapshot is unrestricted. Caller
 *     treats `null` as "show all units" — matches the avulso (no
 *     session) path.
 *   - `Set<string>` with the union of allowlists across the
 *     customer's active subscriptions otherwise.
 *
 * Thin wrapper over `resolveCustomerSubscriptionScope` for callers that
 * only need the spatial axis (eg. org landing page).
 */
export async function resolveCustomerUnitAllowlist(
  orgId: string,
  customerUserId: string,
): Promise<Set<string> | null> {
  const { unitAllowlist } = await fetchCustomerScope(orgId, customerUserId)
  return unitAllowlist
}

/**
 * Combined spatial + temporal scope resolver — brief 0019 Groups A & B.
 *
 * Single Firestore read; caller decides which axes to apply. Both axes
 * follow "most permissive wins" union semantics across active
 * subscriptions (AC-04, extended to Group B).
 *
 * Returns `{ unitAllowlist: null, allowedTimeScope: null }` for visitors
 * with no scope-bearing subscription — equivalent to the avulso path.
 */
export async function resolveCustomerSubscriptionScope(
  orgId: string,
  customerUserId: string,
): Promise<CustomerSubscriptionScope> {
  return fetchCustomerScope(orgId, customerUserId)
}

/**
 * Session-aware wrapper — resolves the visitor's scope when they're
 * signed in, or returns `null` for anonymous (avulso) visitors. Reused
 * by the public landing pages (slug, unit, availability, book) so each
 * page doesn't repeat the same `session ? ... : null` boilerplate.
 *
 * Returns `null` distinct from "signed-in with unrestricted plan"
 * (which returns `{ unitAllowlist: null, allowedTimeScope: null, ... }`)
 * — callers that care about the difference can still tell them apart.
 */
export async function resolveScopeForSession(
  orgId: string,
): Promise<CustomerSubscriptionScope | null> {
  const session = await getSessionUser()
  if (!session) return null
  return fetchCustomerScope(orgId, session.uid)
}

/**
 * Same as `resolveScopeForSession`, but resolves the org from a slug
 * first. For pages that don't already have a org id in scope
 * (eg. the availability page, which only reads the slug from the URL).
 *
 * Returns `null` when the visitor is anonymous OR the slug doesn't
 * resolve to a org — the caller treats both the same way (no banner,
 * no scope filter).
 */
export async function resolveScopeForSessionBySlug(
  slug: string,
): Promise<CustomerSubscriptionScope | null> {
  const session = await getSessionUser()
  if (!session) return null
  const org = await getOrgBySlug(slug)
  if (!org) return null
  return fetchCustomerScope(org.id, session.uid)
}
