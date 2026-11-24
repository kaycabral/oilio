import { Schema } from 'effect'

export const TaxIdentity = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('individual'), taxId: Schema.String })),
  Schema.mutable(
    Schema.Struct({
      kind: Schema.Literal('company'),
      taxId: Schema.String,
      legalName: Schema.String,
      tradeName: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
)
export type TaxIdentity = typeof TaxIdentity.Type

export function isCompany(t: TaxIdentity): t is Extract<TaxIdentity, { kind: 'company' }> {
  return t.kind === 'company'
}

export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '')
}

export const TaxRegime = Schema.Literal('mei', 'simples_nacional', 'other')
export type TaxRegime = typeof TaxRegime.Type

export function deriveTaxRegime(optsForSimples: boolean, optsForMei: boolean): TaxRegime {
  if (optsForMei) return 'mei'
  if (optsForSimples) return 'simples_nacional'
  return 'other'
}

export const CompanySize = Schema.Literal('micro', 'small', 'other')
export type CompanySize = typeof CompanySize.Type

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

export const UnitFiscal = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('informal') })),
  Schema.mutable(
    Schema.Struct({
      kind: Schema.Literal('company'),
      taxId: Schema.String,
      companyProfile: CompanyProfile,
      formalizedAt: Schema.String,
    }),
  ),
)
export type UnitFiscal = typeof UnitFiscal.Type

export const INFORMAL_UNIT_FISCAL: UnitFiscal = { kind: 'informal' }

export function isCompanyUnitFiscal(f: UnitFiscal): f is Extract<UnitFiscal, { kind: 'company' }> {
  return f.kind === 'company'
}

export function cnpjRaiz(taxId: string): string {
  return normalizeTaxId(taxId).slice(0, 8)
}

export function cnpjOrdem(taxId: string): string {
  return normalizeTaxId(taxId).slice(8, 12)
}

export function isMatrizCnpj(taxId: string): boolean {
  return cnpjOrdem(taxId) === '0001'
}

export function groupUnitsByRaiz<T extends { fiscal: UnitFiscal }>(
  units: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const unit of units) {
    if (!isCompanyUnitFiscal(unit.fiscal)) continue
    const raiz = cnpjRaiz(unit.fiscal.taxId)
    const group = groups.get(raiz)
    if (group) group.push(unit)
    else groups.set(raiz, [unit])
  }
  return groups
}

export const ACTIVE_REGISTRATION_STATUS = 'ATIVA'

export function isActiveRegistrationStatus(status: string): boolean {
  return status.trim().toUpperCase() === ACTIVE_REGISTRATION_STATUS
}
