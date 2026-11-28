import { Brand, Schema } from 'effect'

export type Money = number & Brand.Brand<'Money'>

export const Money = Brand.make<Money>((cents) =>
  Number.isInteger(cents) && cents >= 0
    ? undefined
    : `Money must be a non-negative integer, got ${cents}`,
)

export const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const MoneySchema = NonNegativeInt.pipe(Schema.brand('Money'))

export const NonEmptyString = Schema.String.check(Schema.isNonEmpty())

export type OrgId = string & Brand.Brand<'OrgId'>

export const OrgId = Brand.make<OrgId>((s) =>
  typeof s === 'string' && s.length > 0
    ? undefined
    : `OrgId must be a non-empty string, got '${s}'`,
)

export const OrgIdSchema = NonEmptyString.pipe(Schema.brand('OrgId'))

export type AggregateVersion = number & Brand.Brand<'AggregateVersion'>

export const AggregateVersion = Brand.make<AggregateVersion>((n) =>
  Number.isInteger(n) && n >= 0
    ? undefined
    : `AggregateVersion must be a non-negative integer, got ${n}`,
)
