import { Schema } from 'effect'

export const TaxIdentity = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('individual'), taxId: Schema.String })),
  Schema.mutable(
    Schema.Struct({
      kind: Schema.Literal('company'),
      taxId: Schema.String,
      legalName: Schema.String,
      // Nome fantasia. PII-treated alongside `legalName` (a MEI's trade name can
      // carry the owner's civil name), so it lives in the deletable doc, never
      // in the event payload. Optional: many companies have no trade name.
      tradeName: Schema.optional(Schema.NullOr(Schema.String)),
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

// --- Company registry profile (corporate, non-PII) -------------------------
//
// Data about the legal entity, sourced from the public CNPJ registry
// (BrasilAPI). Under the LGPD this is NOT personal data — it identifies the
// company, not a natural person — so it rides in the `org.created` event
// payload and the `StoredOrg` projection: queryable and replay-safe. The
// name-bearing fields (razão social / nome fantasia) deliberately stay OUT of
// here, in the deletable PII doc, because a MEI's razão social embeds a civil
// name. See ADR 0010 (PII never in the event payload) + brief 0046.

export const TaxRegime = Schema.Literal('mei', 'simples_nacional', 'other')
export type TaxRegime = typeof TaxRegime.Type

// Derives the tax regime from the BrasilAPI opt-in flags. The
// `regime_tributario` array the API returns is unreliable (often empty), so we
// read the booleans. MEI wins over Simples: a MEI is always in Simples too, but
// the MEI regime is the more specific truth.
export function deriveTaxRegime(optsForSimples: boolean, optsForMei: boolean): TaxRegime {
  if (optsForMei) return 'mei'
  if (optsForSimples) return 'simples_nacional'
  return 'other'
}

export const CompanySize = Schema.Literal('micro', 'small', 'other')
export type CompanySize = typeof CompanySize.Type

// Maps the Receita `codigo_porte` to a coarse size bucket.
// 1 = ME (microempresa) · 3 = EPP (empresa de pequeno porte) · 5 = demais.
export function deriveCompanySize(codigoPorte: number): CompanySize {
  if (codigoPorte === 1) return 'micro'
  if (codigoPorte === 3) return 'small'
  return 'other'
}

export const CnaeActivity = Schema.mutable(
  Schema.Struct({ code: Schema.String, description: Schema.String }),
)
export type CnaeActivity = typeof CnaeActivity.Type

export const CompanyProfile = Schema.mutable(
  Schema.Struct({
    taxId: Schema.String,
    isMei: Schema.Boolean,
    taxRegime: TaxRegime,
    primaryActivity: CnaeActivity,
    secondaryActivities: Schema.mutable(Schema.Array(CnaeActivity)),
    companySize: CompanySize,
    legalNature: Schema.String,
    registrationStatus: Schema.String,
    shareCapital: Schema.Number,
    activityStartedAt: Schema.String,
  }),
)
export type CompanyProfile = typeof CompanyProfile.Type
