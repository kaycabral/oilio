import type { EventMeta } from '@/domain/effect/event-store'
import type { UnitEvent } from './events'
import type { UnitState } from './types'

export function applyUnitEvent(state: UnitState, event: UnitEvent, meta: EventMeta): UnitState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'unit.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'unit.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'unit.archived':
      return { ...base, archivedAt: event.archivedAt }
    case 'unit.formalized':
      return {
        ...base,
        fiscal: {
          kind: 'company',
          taxId: event.taxId,
          companyProfile: event.companyProfile,
          formalizedAt: event.formalizedAt,
        },
      }
    case 'unit.deleted':
      return base
  }
}
