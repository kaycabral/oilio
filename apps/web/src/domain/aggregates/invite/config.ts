import type { AggregateConfig } from '@/domain/effect/event-store'
import { InviteEventSchema, type InviteEvent } from './events'
import { applyInviteEvent } from './reducer'
import { INITIAL_INVITE_STATE, type InviteState } from './types'

export const InviteConfig: AggregateConfig<InviteState, InviteEvent> = {
  type: 'invite',
  initialState: INITIAL_INVITE_STATE,
  reducer: applyInviteEvent,
  schema: InviteEventSchema,
  currentSchemaVersion: 1,
}
