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
      // informal → company: the fiscal union becomes the single source of the
      // company stage (CNPJ-14 + registry profile + formalization boundary).
      // Matriz/filial/raiz are derived from `taxId` on read, never stored.
      return {
        ...base,
        fiscal: {
          kind: 'company',
          taxId: event.taxId,
          companyProfile: event.companyProfile,
          formalizedAt: event.formalizedAt,
        },
      }
    case 'unit.self_booking_published':
      // Self-booking publish is an appointment-agenda concern: the publish state
      // lives ONLY in the `appointment` variant of `Unit.agenda`. A publish event
      // on a non-appointment unit is a no-op (can't happen via the action, which
      // guards on mode) — leave the agenda untouched rather than fabricate the
      // appointment-only fields.
      return state.agenda.mode === 'appointment'
        ? {
            ...base,
            agenda: {
              ...state.agenda,
              selfBookingPublished: true,
              selfBookingPublishedAt: meta.timestamp,
            },
          }
        : base
    case 'unit.self_booking_unpublished':
      return state.agenda.mode === 'appointment'
        ? { ...base, agenda: { ...state.agenda, selfBookingPublished: false } }
        : base
    case 'unit.deleted':
      return base
  }
}
