import type { EventMeta } from '@/domain/effect/event-store'
import type { MemberOperationEvent } from './events'
import type { MemberOperationState } from './types'

export function applyMemberOperationEvent(
  state: MemberOperationState,
  event: MemberOperationEvent,
  meta: EventMeta,
): MemberOperationState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'member_operation.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'member_operation.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'member_operation.deleted':
      return base
    // Operational-readiness transitions are NO-OPS (#1226 AC-02). The status is
    // no longer materialized on the projection — it is DERIVED on read from real
    // facts (whatsapp present ∧ ≥1 unit ∧ ≥1 service; see `deriveOperationalStatus`).
    // New writes no longer emit these events, but the schemas stay in the union
    // and the cases stay here so HISTORICAL streams (which DID emit them) still
    // replay without breaking — they simply leave the state untouched.
    case 'member_operation.activated':
      return base
    case 'member_operation.suspended':
      return base
  }
}
