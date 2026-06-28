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
      // `event.data` is a full doc whose own createdAt/updatedAt may be empty
      // (built from the Free default before activation) — the stream meta is the
      // source of truth for both timestamps, so re-assert them AFTER the spread.
      return {
        ...base,
        ...event.data,
        createdAt: state.createdAt || meta.timestamp,
        updatedAt: meta.timestamp,
      }
    case 'org_billing.updated':
    case 'org_billing.canceled':
      // A partial update may be the FIRST event for this org (Stripe doesn't
      // guarantee checkout.session.completed arrives before subscription.updated).
      // Seed createdAt from meta when absent so the projection never writes an
      // empty timestamp; id/orgId come from the changes (the webhook always sets
      // them) and fall back to whatever the prior state held.
      return { ...base, ...event.changes, createdAt: state.createdAt || meta.timestamp }
  }
}
