import type { AggregateConfig } from '@/domain/effect/event-store'
import { ProfessionalEventSchema, type ProfessionalEvent } from './events'
import { applyProfessionalEvent } from './reducer'
import { INITIAL_PROFESSIONAL_STATE, type ProfessionalState } from './types'

export const ProfessionalConfig: AggregateConfig<ProfessionalState, ProfessionalEvent> = {
  type: 'professional',
  initialState: INITIAL_PROFESSIONAL_STATE,
  reducer: applyProfessionalEvent,
  schema: ProfessionalEventSchema,
  // Stays 1 despite the professional service-FK field rename (B2 / brief 0052):
  // no upcaster ships because Onda 1 assumes RE-SEED — oilio is pre-prod with no
  // persisted professional events (PRD § "Migração de dado histórico"). If oilio
  // ever gains production data, a field rename like this MUST bump the version
  // and register an upcaster mapping the legacy key on historical
  // professional.created.data / professional.updated.changes — otherwise replay
  // silently drops the link (Effect decodes with onExcessProperty='ignore').
  currentSchemaVersion: 1,
}
