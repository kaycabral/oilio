import { Schema } from 'effect'

import {
  type CnaeActivity,
  type CompanyProfile,
  deriveCompanySize,
  deriveTaxRegime,
} from '@/domain'

// Subset of the BrasilAPI `cnpj/v1` payload we consume. Every field is optional
// (and the numeric ones tolerate the string form the API sometimes returns) so
// a partial/degraded response normalizes to safe defaults instead of throwing.
const CnaeSecundaria = Schema.Struct({
  codigo: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  descricao: Schema.optional(Schema.String),
})

export const BrasilApiCnpjResponse = Schema.Struct({
  cnpj: Schema.optional(Schema.String),
  razao_social: Schema.optional(Schema.String),
  nome_fantasia: Schema.optional(Schema.String),
  descricao_situacao_cadastral: Schema.optional(Schema.String),
  opcao_pelo_simples: Schema.optional(Schema.NullOr(Schema.Boolean)),
  opcao_pelo_mei: Schema.optional(Schema.NullOr(Schema.Boolean)),
  codigo_porte: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  cnae_fiscal: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  cnae_fiscal_descricao: Schema.optional(Schema.String),
  cnaes_secundarios: Schema.optional(Schema.Array(CnaeSecundaria)),
  natureza_juridica: Schema.optional(Schema.String),
  capital_social: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  data_inicio_atividade: Schema.optional(Schema.String),
})
export type BrasilApiCnpjResponse = typeof BrasilApiCnpjResponse.Type

// What the lookup endpoint returns. Split by LGPD class so the caller
// (`createTenant`, #1132) can route each part to its home: `profile` is
// corporate (→ `tenant.created` event + `StoredTenant`), while `legalName` /
// `tradeName` are PII (→ deletable doc). `profile.registrationStatus` drives
// the ATIVA gate. See brief 0046.
export type CompanyLookup = {
  profile: CompanyProfile
  legalName: string
  tradeName: string | null
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toCode(value: number | string | undefined): string {
  return value === undefined ? '' : String(value)
}

function nonEmptyOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

// Maps a decoded BrasilAPI response into our domain shape. Pure (no I/O) so the
// snake_case→domain mapping + regime/size derivations are unit-tested without
// the network. `taxId` comes from the validated request param, not the body.
export function normalizeCompanyLookup(raw: BrasilApiCnpjResponse, taxId: string): CompanyLookup {
  const optsForSimples = raw.opcao_pelo_simples === true
  const isMei = raw.opcao_pelo_mei === true

  const secondaryActivities: CnaeActivity[] = (raw.cnaes_secundarios ?? []).map((c) => ({
    code: toCode(c.codigo),
    description: c.descricao ?? '',
  }))

  const profile: CompanyProfile = {
    taxId,
    isMei,
    taxRegime: deriveTaxRegime(optsForSimples, isMei),
    primaryActivity: {
      code: toCode(raw.cnae_fiscal),
      description: raw.cnae_fiscal_descricao ?? '',
    },
    secondaryActivities,
    companySize: deriveCompanySize(toNumber(raw.codigo_porte)),
    legalNature: raw.natureza_juridica ?? '',
    registrationStatus: raw.descricao_situacao_cadastral ?? '',
    shareCapital: toNumber(raw.capital_social),
    activityStartedAt: raw.data_inicio_atividade ?? '',
  }

  return {
    profile,
    legalName: raw.razao_social ?? '',
    tradeName: nonEmptyOrNull(raw.nome_fantasia),
  }
}
