import type { EventMeta } from '@/domain/effect/event-store'
import type { OrgBillingEvent } from './events'
import type { OrgBillingState } from './types'

export function applyOrgBillingEvent(
  state: OrgBillingState,
  event: OrgBillingEvent,
  meta: EventMeta,
): OrgBillingState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'org_billing.activated':
      return {
        ...base,
        ...event.data,
        createdAt: state.createdAt || meta.timestamp,
        updatedAt: meta.timestamp,
      }
    case 'org_billing.updated':
    case 'org_billing.canceled':
      return { ...base, ...event.changes, createdAt: state.createdAt || meta.timestamp }
  }
}
