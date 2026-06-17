import { Schema } from 'effect'

export const TaxIdentity = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('individual'), taxId: Schema.String })),
  Schema.mutable(
    Schema.Struct({
      kind: Schema.Literal('company'),
      taxId: Schema.String,
      legalName: Schema.String,
    }),
  ),
)
export type TaxIdentity = typeof TaxIdentity.Type

export function isCompany(t: TaxIdentity): t is Extract<TaxIdentity, { kind: 'company' }> {
  return t.kind === 'company'
}

const DIGITS_ONLY = /^\d+$/

export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function isValidIndividualTaxId(raw: string): boolean {
  const v = normalizeTaxId(raw)
  return v.length === 11 && DIGITS_ONLY.test(v)
}

export function isValidCompanyTaxId(raw: string): boolean {
  const v = normalizeTaxId(raw)
  return v.length === 14 && DIGITS_ONLY.test(v)
}
