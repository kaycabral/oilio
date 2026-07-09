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
    case 'member_operation.activated':
      return base
    case 'member_operation.suspended':
      return base
  }
}
