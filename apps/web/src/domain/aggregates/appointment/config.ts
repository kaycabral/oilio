import type { AggregateConfig } from '@/domain/effect/event-store'
import { AppointmentEventSchema, type AppointmentEvent } from './events'
import { applyAppointmentEvent } from './reducer'
import { INITIAL_APPOINTMENT_STATE, type AppointmentState } from './types'

export const AppointmentConfig: AggregateConfig<AppointmentState, AppointmentEvent> = {
  type: 'appointment',
  initialState: INITIAL_APPOINTMENT_STATE,
  reducer: applyAppointmentEvent,
  schema: AppointmentEventSchema,
  currentSchemaVersion: 1,
}
