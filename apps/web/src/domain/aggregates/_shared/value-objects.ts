import { Brand, Schema } from 'effect'

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
// TenantId — non-empty string
// ---------------------------------------------------------------------------

export type TenantId = string & Brand.Brand<'TenantId'>

export const TenantId = Brand.refined<TenantId>(
  (s) => typeof s === 'string' && s.length > 0,
  (s) => Brand.error(`TenantId must be a non-empty string, got '${s}'`),
)

export const TenantIdSchema = Schema.String.pipe(Schema.nonEmptyString(), Schema.brand('TenantId'))

// ---------------------------------------------------------------------------
// AggregateVersion — non-negative integer
// ---------------------------------------------------------------------------

export type AggregateVersion = number & Brand.Brand<'AggregateVersion'>

export const AggregateVersion = Brand.refined<AggregateVersion>(
  (n) => Number.isInteger(n) && n >= 0,
  (n) => Brand.error(`AggregateVersion must be a non-negative integer, got ${n}`),
)
