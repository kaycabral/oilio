import type { AggregateConfig } from '@/domain/effect/event-store'
import { AgendaBlockEventSchema, type AgendaBlockEvent } from './events'
import { applyAgendaBlockEvent } from './reducer'
import { INITIAL_AGENDA_BLOCK_STATE, type AgendaBlockState } from './types'

export const AgendaBlockConfig: AggregateConfig<AgendaBlockState, AgendaBlockEvent> = {
  type: 'agenda_block',
  initialState: INITIAL_AGENDA_BLOCK_STATE,
  reducer: applyAgendaBlockEvent,
  schema: AgendaBlockEventSchema,
  currentSchemaVersion: 1,
}
