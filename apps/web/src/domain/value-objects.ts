import { Brand, Schema } from 'effect'

// Shared schema-level value objects + invariants for the read-model kernel.
// Lives at the domain ROOT (below both `types/` and `aggregates/`) so a
// read-model type (`types/*.ts`) can import these without inverting the
// `aggregates → types` layering. `aggregates/_shared/value-objects.ts`
// re-exports from here for backward compatibility with existing call-sites.

// ---------------------------------------------------------------------------
// Money — integer cents, non-negative
// ---------------------------------------------------------------------------

export type Money = number & Brand.Brand<'Money'>

export const Money = Brand.refined<Money>(
  (cents) => Number.isInteger(cents) && cents >= 0,
  (cents) => Brand.error(`Money must be a non-negative integer, got ${cents}`),
)

export const MoneySchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.brand('Money'),
)

// ---------------------------------------------------------------------------
// NonEmptyString — the canonical "required business field is not blank"
// invariant for read-model schemas (#1283). A bare `Schema.String` accepts the
// zero-value `''`; a required-by-business field must reject it AT THE DOMAIN
// BOUNDARY (the event decode in `appendEventToTx`), not only at the DB CHECK.
// This is a CONSTRAINT, not a semantic value object, so it is NOT branded
// (branding `customerId` as non-empty buys a type-level guard at viral cost,
// for a case the decode + DB CHECK already close — decided #1287). Use this for
// required ids/labels; pair it with a `*_nonempty` CHECK on scalar columns.
// `MoneySchema` (above) is the numeric sibling for `*Cents` ranges.
// ---------------------------------------------------------------------------

export const NonEmptyString = Schema.String.pipe(Schema.nonEmptyString())

// NonNegativeInt — the numeric sibling of NonEmptyString for `*Cents` amounts
// and counters (#1283 / brief 0078 Group G). Mirrors the DB `check(>= 0)` at the
// read-model boundary: a bare `Schema.Number` accepts negative/fractional, which
// only the DB CHECK would catch (the `23514`-at-INSERT gap). Unbranded — like
// NonEmptyString, it's a CONSTRAINT, not a semantic value object, so it keeps
// `.Type = number` and adds zero blast radius to arithmetic call-sites (unlike
// the branded `MoneySchema`, reserved for fields that want the `Money` identity).
export const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

// ---------------------------------------------------------------------------
// OrgId — non-empty string
// ---------------------------------------------------------------------------

export type OrgId = string & Brand.Brand<'OrgId'>

export const OrgId = Brand.refined<OrgId>(
  (s) => typeof s === 'string' && s.length > 0,
  (s) => Brand.error(`OrgId must be a non-empty string, got '${s}'`),
)

export const OrgIdSchema = Schema.String.pipe(Schema.nonEmptyString(), Schema.brand('OrgId'))

// ---------------------------------------------------------------------------
// AggregateVersion — non-negative integer
// ---------------------------------------------------------------------------

export type AggregateVersion = number & Brand.Brand<'AggregateVersion'>

export const AggregateVersion = Brand.refined<AggregateVersion>(
  (n) => Number.isInteger(n) && n >= 0,
  (n) => Brand.error(`AggregateVersion must be a non-negative integer, got ${n}`),
)
