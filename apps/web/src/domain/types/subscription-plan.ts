import { Schema } from 'effect'

export const BillingCycle = Schema.Literal('monthly', 'quarterly', 'semiannual', 'annual')
export type BillingCycle = typeof BillingCycle.Type

export const BILLING_CYCLES: readonly BillingCycle[] = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]

export const UsageLimit = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('unlimited') })),
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('count'), quantity: Schema.Number })),
)
export type UsageLimit = typeof UsageLimit.Type

// Temporal scope rule (brief 0019, Group B). Each sub-field is optional and
// `undefined` collapses to "no restriction on that axis". Snapshot semantics
// mirror `unitAllowlist`: frozen into Subscription on creation, never
// retroactive.
//
// - `daysOfWeek`: ISO weekday numbers (0=Sun … 6=Sat). When set, only listed
//   weekdays are bookable. Empty array would be senseless ("nothing
//   bookable"), so the parser collapses empty → `undefined`.
// - `hourRange`: HH:mm strings in org local time. Slots whose local start
//   falls outside `[start, end)` are hidden. Inclusive start, exclusive end
//   matches business-hours semantics.
// - `advanceBookingDays`: max days ahead a subscriber can book from "today
//   in org tz". `0` would forbid bookings entirely so the parser also
//   collapses non-positive → `undefined`.
export const AllowedTimeScope = Schema.mutable(
  Schema.Struct({
    daysOfWeek: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))),
    hourRange: Schema.optional(
      Schema.mutable(Schema.Struct({ start: Schema.String, end: Schema.String })),
    ),
    advanceBookingDays: Schema.optional(Schema.Number),
  }),
)
export type AllowedTimeScope = typeof AllowedTimeScope.Type

// Behavioral scope rule (brief 0019, Group C). Each sub-field is optional and
// `undefined` collapses to "no restriction on that axis". Snapshot semantics
// mirror `unitAllowlist` / `allowedTimeScope`: frozen into Subscription on
// creation, never retroactive.
//
// - `maxPerDay`: max appointments the customer can hold on the same org
//   day. Undefined = no daily cap. Trying to create the (N+1)th in the same
//   day surfaces a reschedule signal (UI opens a "trocar horário" modal).
// - `maxConcurrent`: cap on confirmed/scheduled future appointments at any
//   instant. Undefined = unlimited. Trying to exceed it returns an error
//   message. Past + cancelled + no-show appointments don't count.
// - `requireCompleteBeforeNext`: when true, blocks any new booking while the
//   customer still has a future appointment that isn't `completed`. Default
//   false. Mutually compatible with the other two limits.
export const BookingLimits = Schema.mutable(
  Schema.Struct({
    maxPerDay: Schema.optional(Schema.Number),
    maxConcurrent: Schema.optional(Schema.Number),
    requireCompleteBeforeNext: Schema.optional(Schema.Boolean),
  }),
)
export type BookingLimits = typeof BookingLimits.Type

export const SubscriptionPlan = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    name: Schema.String,
    description: Schema.NullOr(Schema.String),
    priceCents: Schema.Number,
    billingCycle: BillingCycle,
    // FK array into `CatalogItem.id` (brief 0024, AC-01 — #1008). Canonical
    // per-item coverage: each id references a `orgs/{orgId}/catalog_items/
    // {id}` doc, of ANY kind (service|product). A plan/package is exactly this
    // set of granular items — there is no opaque "combo" item (AC-06). The
    // expansion of `includedCategoryIds` to items at consumption time is slice 2
    // (#1009); here both fields are just stored coverage.
    includedItemIds: Schema.mutable(Schema.Array(Schema.String)),
    // FK array into `Category.id` (brief 0023, AC-04 — #1003). Replaced the
    // former free-text `includedServiceCategories: string[]`. Each id references
    // a `orgs/{orgId}/categories/{id}` doc. Stays as convenience coverage
    // ("all items of category X") alongside the explicit `includedItemIds`
    // (brief 0024, AC-02) — it does NOT replace the per-item list.
    includedCategoryIds: Schema.mutable(Schema.Array(Schema.String)),
    usageLimit: UsageLimit,
    // Spatial scope rule (brief 0019, Group A). When set, the plan restricts
    // self-book coverage to the listed unit ids. Absent OR `null` means "no
    // restriction" (all public org units are covered): `create` omits the
    // field, `update` writes `null` to clear it (event-sourced projection
    // merges via spread, so clearing requires an explicit null). Snapshotted
    // into Subscription on creation — changes here do not retroact.
    unitAllowlist: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(Schema.String)))),
    // Temporal scope rule (brief 0019, Group B). Absent OR `null` = unrestricted
    // on every axis (same create-omits / update-nulls semantics as
    // `unitAllowlist`). Sub-fields independently optional — see
    // `AllowedTimeScope`. Snapshotted into Subscription on creation.
    allowedTimeScope: Schema.optional(Schema.NullOr(AllowedTimeScope)),
    // Behavioral scope rule (brief 0019, Group C). Absent OR `null` = no booking
    // limits (same create-omits / update-nulls semantics). Sub-fields
    // independently optional — see `BookingLimits`. Snapshotted into
    // Subscription on creation.
    bookingLimits: Schema.optional(Schema.NullOr(BookingLimits)),
    active: Schema.Boolean,
    // Uniform delete policy (brief 0027, AC-06). A referenced plan (an active
    // subscription snapshots it) can't be hard-deleted — it's archived instead
    // (`archivedAt` set to an ISO timestamp). Archived plans drop out of active
    // lists/pickers but stay resolvable for historical subscriptions. `null` =
    // active (not archived).
    archivedAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type SubscriptionPlan = typeof SubscriptionPlan.Type
