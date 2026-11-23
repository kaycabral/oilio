import type { EventMeta } from '@/domain/effect/event-store'
import type { AgendaBlockEvent } from './events'
import type { AgendaBlockState } from './types'

export function applyAgendaBlockEvent(
  state: AgendaBlockState,
  event: AgendaBlockEvent,
  meta: EventMeta,
): AgendaBlockState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'agenda_block.created':
      return Object.assign({ ...base }, event.data, {
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      })
    case 'agenda_block.updated':
      return Object.assign({ ...base }, event.changes)
    case 'agenda_block.deleted':
      return base
  }
}
