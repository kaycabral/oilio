export {
  AppointmentConflictError,
  AuthorizationError,
  CardDeclinedError,
  EntityNotFoundError,
  MemberOperationUnavailableError,
  OrderAlreadyClosedError,
  PlanNotActiveError,
  UsageLimitReachedError,
  type DomainError,
} from './errors'

export {
  aggregateRef,
  aggregateRefEquals,
  collectionRef,
  type AggregateRef,
  type AggregateType,
  type CollectionRef,
} from './aggregate-ref'

export {
  LoggerService,
  PersistencePort,
  SecurityContext,
  type FirestoreDoc,
  type PersistenceOps,
  type QueryConstraint,
  type TransactionContext,
} from './services'

export {
  AcquirerLedgerPort,
  BankLedgerPort,
  FiscalLedgerPort,
  type LedgerSourceOps,
  type LedgerSourceWindow,
} from './ledger-source-ports'

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
