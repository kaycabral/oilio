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
  LoggerService,
  PersistencePort,
  SecurityContext,
  type FirestoreDoc,
  type PersistenceOps,
  type QueryConstraint,
  type TransactionContext,
} from './services'

export { checkAppointmentAvailability } from './check-appointment-availability'

export {
  EventValidationError,
  GuardRejectedError,
  ReplayInconsistencyError,
  appendDeleteToTx,
  appendEvent,
  appendEventGuarded,
  appendEventGuardedToTx,
  appendEventToTx,
  buildInitialEvent,
  replayAggregate,
  runSaga,
  type AggregateConfig,
  type EventEnvelope,
  type EventInput,
  type GuardReader,
  type GuardResult,
  type GuardedAppend,
  type SagaError,
  type SagaStep,
} from './event-store'
