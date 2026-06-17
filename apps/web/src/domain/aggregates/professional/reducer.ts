import type { EventMeta } from '@/domain/effect/event-store'
import type { ProfessionalEvent } from './events'
import type { ProfessionalState } from './types'

export function applyProfessionalEvent(
  state: ProfessionalState,
  event: ProfessionalEvent,
  meta: EventMeta,
): ProfessionalState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'professional.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'professional.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'professional.deleted':
      return base
    // Operational-readiness transitions (#1047 / AC-07). `operationalStatus` is
    // projected from the event tag — never written by a UI input. `activated`
    // lets the pro operate (agenda/public catalog/split); `suspended` pulls that
    // back to a non-operating state (reserved cycle, AC-08 deferred). We project
    // `suspended` as `incomplete` because `isOperational` keys only on
    // `operational` and `incomplete` is the "accepted but not operating" value
    // (the `professional.suspended` EVENT is the reserved hook).
    case 'professional.activated':
      return { ...base, operationalStatus: 'operational' }
    case 'professional.suspended':
      return { ...base, operationalStatus: 'incomplete' }
  }
}
