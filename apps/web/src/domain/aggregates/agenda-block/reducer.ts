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
      // `data` is the full `AgendaBlock` (a discriminated union). Layering it
      // over `base` with `Object.assign` keeps the result an `AgendaBlockState`
      // (initial-state defaults preserved, discriminant carried from `data`),
      // where a plain object-literal spread would widen the union and lose
      // narrowing.
      return Object.assign({ ...base }, event.data, {
        createdAt: meta.timestamp,
        updatedAt: meta.timestamp,
      })
    case 'agenda_block.updated':
      // `changes` is a partial over the `AgendaBlock` union; merging it onto the
      // typed accumulator with `Object.assign` keeps the result an
      // `AgendaBlockState` (the discriminant carries over from `state`), where a
      // plain object-literal spread would widen the union and lose narrowing.
      return Object.assign({ ...base }, event.changes)
    case 'agenda_block.deleted':
      return base
  }
}
