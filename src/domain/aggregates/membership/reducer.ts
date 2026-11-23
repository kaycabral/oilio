import type { EventMeta } from '@/domain/effect/event-store'
import type { MembershipEvent } from './events'
import type { MembershipState } from './types'

export function applyMembershipEvent(
  state: MembershipState,
  event: MembershipEvent,
  meta: EventMeta,
): MembershipState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'membership.created':
      return { ...base, ...event.data, joinedAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'membership.updated':
      return { ...base, ...event.changes }
    case 'membership.deleted':
      return base
  }
}
