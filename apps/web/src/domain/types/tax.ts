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

// --- Unit fiscal identity (the Unidade's fiscal lifecycle stage) ------------
//
// The single source of truth for whether a UNIDADE is operating informally or
// has been formalized with a CNPJ (brief 0048 / PRD Identidade v2). The fiscal
// identity belongs to the ESTABLISHMENT (the Unit), not the Org (a pure
// folder): the CNPJ-14 is, by law, the establishment's. Discriminated by
// `kind` (no nullable fiscal fields — the CNPJ literally does not exist without
// formalization):
//   - `informal` → no CNPJ; the Unit operates (agenda, clients, services) but
//     has no fiscal identity. The default for every new/existing Unit.
//   - `company`  → formalized via `unit.formalized`. Carries the
//     establishment's full CNPJ-14 (`taxId`), the public registry
//     `CompanyProfile` (NON-PII), and the `formalizedAt` boundary that dates
//     the PF→PJ fiscal cut.
//
// LGPD: this union is NON-PII (a PJ's CNPJ + registry data identify a company,
// not a natural person), so it rides in `StoredUnit` + the `unit.formalized`
// event payload — queryable and replay-safe. The name-bearing fields (razão
// social / nome fantasia) deliberately stay OUT of here, in the deletable PII
// doc `orgs/{orgId}/units/{unitId}/private/taxIdentity` (a MEI's razão social
// embeds a civil name). See ADR 0010 + brief 0048.
export const UnitFiscal = Schema.Union(
  Schema.mutable(Schema.Struct({ kind: Schema.Literal('informal') })),
  Schema.mutable(
    Schema.Struct({
      kind: Schema.Literal('company'),
      // The establishment's full CNPJ-14 (raiz(8) + ordem(4) + DV(2)). Matriz
      // (`0001`) / filial (`0002+`) and the raiz are DERIVED from it on read,
      // never stored (brief 0048 AC-09).
      taxId: Schema.String,
      companyProfile: CompanyProfile,
      // ISO timestamp of formalization — the dated PF→PJ fiscal boundary
      // (brief 0048 AC-10): pre = renda PF (out of the DRE), post = receita PJ.
      formalizedAt: Schema.String,
    }),
  ),
)
export type UnitFiscal = typeof UnitFiscal.Type

export const INFORMAL_UNIT_FISCAL: UnitFiscal = { kind: 'informal' }

export function isCompanyUnitFiscal(f: UnitFiscal): f is Extract<UnitFiscal, { kind: 'company' }> {
  return f.kind === 'company'
}

// --- CNPJ-14 structure derivations (lei, RFB/gov.br) ------------------------
//
// CNPJ-14 = RAIZ(8) + ORDEM(4) + DV(2). The raiz identifies the empresa; the
// ordem identifies the establishment (`0001` = matriz, `0002+` = filial). These
// are PURE derivations off the CNPJ-14 — the matriz/filial flag and the raiz
// are NEVER stored (brief 0048 AC-09); the "empresa-legal" (units of the same
// raiz) is a read-only projection. Expects a normalized 14-digit string.

export function cnpjRaiz(taxId: string): string {
  return normalizeTaxId(taxId).slice(0, 8)
}

export function cnpjOrdem(taxId: string): string {
  return normalizeTaxId(taxId).slice(8, 12)
}

// Matriz = ordem `0001`. Any other ordem is a filial.
export function isMatrizCnpj(taxId: string): boolean {
  return cnpjOrdem(taxId) === '0001'
}

// Group `company` units by their CNPJ raiz — the read-only "empresa-legal"
// projection (brief 0048 AC-09). Informal units carry no CNPJ and simply do not
// participate (they are skipped, never an error: this is NOT an integrity
// invariant). Units of different raízes land in different groups. The map is
// keyed by the 8-digit raiz; insertion order is preserved within each group.
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

// The Receita situação cadastral that gates formalization (brief 0048 AC-05):
// only an ATIVA company may formalize. Compared case-insensitively.
export const ACTIVE_REGISTRATION_STATUS = 'ATIVA'

export function isActiveRegistrationStatus(status: string): boolean {
  return status.trim().toUpperCase() === ACTIVE_REGISTRATION_STATUS
}

// Masks a CNPJ to the canonical `00.000.000/0000-00` form as the owner types
// (brief 0048 AC-07, owner feedback). Pure: strips non-digits, caps at 14, then
// inserts the separators progressively so a partial entry stays legible.
export function formatCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12, 14)]
  let out = parts[0] ?? ''
  if (d.length > 2) out += `.${parts[1]}`
  if (d.length > 5) out += `.${parts[2]}`
  if (d.length > 8) out += `/${parts[3]}`
  if (d.length > 12) out += `-${parts[4]}`
  return out
}
