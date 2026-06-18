import { EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS, type StoredUnit } from '@/domain/types/unit'

// Projeção event-sourced = o doc operacional `StoredUnit` (PII whatsapp/email
// omitida — materializada na leitura via unit-read) + a versão do stream.

export type UnitState = StoredUnit & { readonly _version: number }

// Zero-value before any `unit.created` event applies. `address`/`businessHours`/
// `hoursMode` are non-nullable in the v2 schema (PRD Identidade), so the initial
// state uses canonical empties — always overwritten by the `unit.created` payload
// (which carries the full StoredUnit), never observed on a real unit.
export const INITIAL_UNIT_STATE: UnitState = {
  id: '',
  orgId: '',
  name: '',
  slug: '',
  address: EMPTY_ADDRESS,
  businessHours: EMPTY_BUSINESS_HOURS,
  hoursMode: 'fixed',
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
