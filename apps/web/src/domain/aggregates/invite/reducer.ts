import type { EventMeta } from '@/domain/effect/event-store'
import type { InviteEvent } from './events'
import type { InviteState } from './types'

export function applyInviteEvent(
  state: InviteState,
  event: InviteEvent,
  meta: EventMeta,
): InviteState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'invite.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'invite.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'invite.deleted':
      return base
  }
}
