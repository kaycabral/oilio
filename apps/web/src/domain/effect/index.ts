export {
  AppointmentConflictError,
  AuthorizationError,
  CardDeclinedError,
  EntityNotFoundError,
  OrderAlreadyClosedError,
  PlanNotActiveError,
  ProfessionalUnavailableError,
  UsageLimitReachedError,
  type DomainError,
} from './errors'

export {
  FirestoreService,
  LoggerService,
  type FirestoreDoc,
  type QueryConstraint,
  type TransactionContext,
} from './services'

export { checkAppointmentAvailability } from './check-appointment-availability'

export {
  EventValidationError,
  GuardRejectedError,
  ReplayInconsistencyError,
  appendEvent,
  appendEventGuarded,
  buildInitialEvent,
  replayAggregate,
  type AggregateConfig,
  type EventEnvelope,
  type EventInput,
  type GuardReader,
  type GuardResult,
  type GuardedAppend,
} from './event-store'
