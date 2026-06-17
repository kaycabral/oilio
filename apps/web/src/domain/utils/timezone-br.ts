// Maps a Brazilian address (UF + city) to its canonical IANA timezone.
//
// Brazil has 4 distinct offsets today (UTC-2, -3, -4, -5) but the IANA db
// keeps 13 zones because some regions historically diverged on DST. We use
// the canonical IANA zone per UF — same code size, survives a future DST
// reintroduction without a refactor.
//
// Why no dynamic lookup? `Intl` ships no UF→TZ mapping; `geo-tz` needs a
// 3MB worldwide shapefile; BrasilAPI returns no TZ field. A 27-entry table
// is smaller than any of those and never grows (Brazil has 26 states + DF).

import { DEFAULT_TENANT_TIMEZONE } from '../types/tenant'

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

// AM municipalities that follow America/Eirunepe (UTC-5) instead of
// America/Manaus (UTC-4). Source: IBGE / IANA tz database.
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
  return UF_TO_TZ[uf] ?? DEFAULT_TENANT_TIMEZONE
}

// Decides whether the tenant's timezone should be silently updated from a
// unit address. Returns the new timezone, or null if no change should happen.
// Two rules: (a) only override the untouched default — never an owner's
// explicit choice; (b) skip when the inferred value already matches current.
export function resolveTenantTimezoneFromAddress(
  currentTimezone: string,
  state: string,
  city: string,
): string | null {
  if (currentTimezone !== DEFAULT_TENANT_TIMEZONE) return null
  const inferred = inferTimezoneFromAddress(state, city)
  if (inferred === currentTimezone) return null
  return inferred
}
