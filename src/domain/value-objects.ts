import { Brand, Schema } from 'effect'

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

export const NonEmptyString = Schema.String.pipe(Schema.nonEmptyString())

export const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export type OrgId = string & Brand.Brand<'OrgId'>

export const OrgId = Brand.refined<OrgId>(
  (s) => typeof s === 'string' && s.length > 0,
  (s) => Brand.error(`OrgId must be a non-empty string, got '${s}'`),
)

export const OrgIdSchema = Schema.String.pipe(Schema.nonEmptyString(), Schema.brand('OrgId'))

export type AggregateVersion = number & Brand.Brand<'AggregateVersion'>

export const AggregateVersion = Brand.refined<AggregateVersion>(
  (n) => Number.isInteger(n) && n >= 0,
  (n) => Brand.error(`AggregateVersion must be a non-negative integer, got ${n}`),
)
