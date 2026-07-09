import {
  DEFAULT_UNIT_FISCAL,
  DEFAULT_UNIT_TIMEZONE,
  EMPTY_ADDRESS,
  EMPTY_AGENDA_CONFIG,
  type StoredUnit,
} from '@/domain/types/unit'

export type UnitState = StoredUnit & { readonly _version: number }

export const INITIAL_UNIT_STATE: UnitState = {
  id: '',
  orgId: '',
  name: '',
  slug: '',
  address: EMPTY_ADDRESS,
  timezone: DEFAULT_UNIT_TIMEZONE,
  agenda: EMPTY_AGENDA_CONFIG,
  archivedAt: null,
  fiscal: DEFAULT_UNIT_FISCAL,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
