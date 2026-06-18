import type { EventMeta } from '@/domain/effect/event-store'
import type { OrgEvent } from './events'
import type { OrgState } from './types'

export function applyOrgEvent(state: OrgState, event: OrgEvent, meta: EventMeta): OrgState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'org.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'org.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'org.self_booking_published':
      return { ...base, selfBookingPublished: true, selfBookingPublishedAt: meta.timestamp }
    case 'org.self_booking_unpublished':
      return { ...base, selfBookingPublished: false }
    case 'org.formalized':
      // informal → company: the fiscalProfile becomes the single source of the
      // company stage (CNPJ-14 + registry profile + formalization boundary).
      return {
        ...base,
        fiscalProfile: {
          stage: 'company',
          taxId: event.taxId,
          companyProfile: event.companyProfile,
          formalizedAt: event.formalizedAt,
        },
      }
    case 'org.deleted':
      return base
  }
}
