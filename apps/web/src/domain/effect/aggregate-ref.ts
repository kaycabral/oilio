// ---------------------------------------------------------------------------
// AggregateRef — the typed identity of an event-sourced/CRUD aggregate
// ---------------------------------------------------------------------------
//
// D6 (ADR 0013): replaces the Firestore-legacy `aggregate_path` string
// (`orgs/{orgId}/{type}/{id}`) as the vocabulary of the `PersistencePort`. The
// path carried three responsibilities derived by `String.split('/')` — routing
// to the typed projector, deriving `org_id` for RLS, and being the
// `events.aggregate_id`. All three become first-class typed data here:
//
//   - `type` is a CLOSED union (not `string`) — a non-existent aggregate type
//     does not compile, and the projector registry lookup is total.
//   - `orgId` is explicit — RLS reads it from the ref / SecurityContext, never
//     re-parses it out of a string (killing the `memberships/{orgId}_{userId}`
//     special case and its `lastIndexOf('_')` bug).
//   - `id` is the bare aggregate id — it becomes `events.aggregate_id`, with
//     `(aggregate_type, org_id)` as sibling columns, so the event uniqueness is
//     `UNIQUE(aggregate_type, org_id, aggregate_id, version)`.
//
// A ref is built with `aggregateRef(config, orgId, id)`, deriving `type` from
// `config.type` — identity and config can never desync, and the type can never
// be mistyped (it comes from the config, not a string literal).

/**
 * The closed set of aggregate types — the `type` literal every `AggregateConfig`
 * declares (singular, the canonical aggregate identity). Source of truth for the
 * projector registry key and the `events.aggregate_type` column. Adding an
 * aggregate = adding its literal here (the compiler then forces the registry +
 * config to line up).
 */
export type AggregateType =
  | 'agenda_block'
  | 'appointment'
  | 'cash_movement'
  | 'catalog_item'
  | 'category'
  | 'charge'
  | 'commission'
  | 'customer'
  | 'goal'
  | 'invite'
  | 'membership'
  | 'notification'
  | 'order'
  | 'org'
  | 'org_billing'
  | 'member_operation'
  | 'subscription'
  | 'subscription_plan'
  | 'unit'

/**
 * The typed identity of a single aggregate instance. Replaces the
 * `orgs/{orgId}/{type}/{id}` path string across the persistence seam (D6).
 */
export type AggregateRef = {
  readonly type: AggregateType
  readonly orgId: string
  readonly id: string
}

/**
 * The identity of an aggregate COLLECTION within an org — the read scope for
 * `getDocs`/`list` (e.g. "all notifications of org X"). Replaces the
 * `orgs/{orgId}/{type}` collection-path string.
 */
export type CollectionRef = {
  readonly type: AggregateType
  readonly orgId: string
}

// A config carries its own `type` (event-store.ts) — `aggregateRef` derives the
// ref's `type` from it so the call-site only supplies the instance coordinates
// (orgId, id). This is what makes every one of the ~433 migration sites
// compile-checked: a wrong config or a swapped arg fails typecheck.
type ConfigWithType = { readonly type: AggregateType }

/** Builds an {@link AggregateRef}, deriving `type` from the aggregate config. */
export function aggregateRef(config: ConfigWithType, orgId: string, id: string): AggregateRef {
  return { type: config.type, orgId, id }
}

/** Builds a {@link CollectionRef} for an aggregate-type read scope within an org. */
export function collectionRef(config: ConfigWithType, orgId: string): CollectionRef {
  return { type: config.type, orgId }
}

/** True when two refs point at the same aggregate instance. */
export function aggregateRefEquals(a: AggregateRef, b: AggregateRef): boolean {
  return a.type === b.type && a.orgId === b.orgId && a.id === b.id
}
