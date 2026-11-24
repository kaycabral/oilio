import { DEFAULT_UNIT_TIMEZONE } from '../types/unit'

export const UF_TO_TZ: Readonly<Record<string, string>> = {
  AC: 'America/Rio_Branco',
  AL: 'America/Maceio',
  AM: 'America/Manaus',
  AP: 'America/Belem',
  BA: 'America/Bahia',
  CE: 'America/Fortaleza',
  DF: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  GO: 'America/Sao_Paulo',
  MA: 'America/Fortaleza',
  MG: 'America/Sao_Paulo',
  MS: 'America/Campo_Grande',
  MT: 'America/Cuiaba',
  PA: 'America/Belem',
  PB: 'America/Fortaleza',
  PE: 'America/Recife',
  PI: 'America/Fortaleza',
  PR: 'America/Sao_Paulo',
  RJ: 'America/Sao_Paulo',
  RN: 'America/Fortaleza',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
  RS: 'America/Sao_Paulo',
  SC: 'America/Sao_Paulo',
  SE: 'America/Maceio',
  SP: 'America/Sao_Paulo',
  TO: 'America/Araguaina',
}

const WESTERN_AMAZONAS_CITIES: ReadonlySet<string> = new Set([
  'eirunepe',
  'benjamin constant',
  'tabatinga',
  'atalaia do norte',
  'guajara',
  'ipixuna',
  'envira',
  'itamarati',
  'jutai',
  'sao paulo de olivenca',
  'amatura',
  'tonantins',
  'fonte boa',
])

const FERNANDO_NORONHA_CITIES: ReadonlySet<string> = new Set(['fernando de noronha'])

function normalizeCity(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

export function inferTimezoneFromAddress(state: string, city: string): string {
  const uf = state.trim().toUpperCase()
  const normalizedCity = normalizeCity(city)

  if (uf === 'PE' && FERNANDO_NORONHA_CITIES.has(normalizedCity)) {
    return 'America/Noronha'
  }
  if (uf === 'AM' && WESTERN_AMAZONAS_CITIES.has(normalizedCity)) {
    return 'America/Eirunepe'
  }
  return UF_TO_TZ[uf] ?? DEFAULT_UNIT_TIMEZONE
}

export function resolveOrgTimezoneFromAddress(
  currentTimezone: string,
  state: string,
  city: string,
): string | null {
  if (currentTimezone !== DEFAULT_UNIT_TIMEZONE) return null
  const inferred = inferTimezoneFromAddress(state, city)
  if (inferred === currentTimezone) return null
  return inferred
}
