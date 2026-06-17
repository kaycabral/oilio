import type { AggregateConfig } from '@/domain/effect/event-store'
import { ProfessionalEventSchema, type ProfessionalEvent } from './events'
import { applyProfessionalEvent } from './reducer'
import { INITIAL_PROFESSIONAL_STATE, type ProfessionalState } from './types'

export const ProfessionalConfig: AggregateConfig<ProfessionalState, ProfessionalEvent> = {
  type: 'professional',
  initialState: INITIAL_PROFESSIONAL_STATE,
  reducer: applyProfessionalEvent,
  schema: ProfessionalEventSchema,
  currentSchemaVersion: 1,
}
