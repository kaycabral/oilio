import type { StoredUnit } from '@/domain/types/unit'

// Projeção event-sourced = o doc operacional `StoredUnit` (PII whatsapp/email
// omitida — materializada na leitura via unit-read) + a versão do stream.

export type UnitState = StoredUnit & { readonly _version: number }

export const INITIAL_UNIT_STATE: UnitState = {
  id: '',
  orgId: '',
  name: '',
  slug: '',
  address: null,
  businessHours: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
