import { Data } from 'effect'

export class AppointmentConflictError extends Data.TaggedError('AppointmentConflictError')<{
  readonly professionalId: string
  readonly proposedStart: string
  readonly proposedEnd: string
  readonly conflictingIds: readonly string[]
}> {}

export class PlanNotActiveError extends Data.TaggedError('PlanNotActiveError')<{
  readonly subscriptionId: string
  readonly currentStatus: string
}> {}

export class UsageLimitReachedError extends Data.TaggedError('UsageLimitReachedError')<{
  readonly subscriptionId: string
  readonly limitKind: string
  readonly consumed: number
  readonly limit: number
}> {}

export class ProfessionalUnavailableError extends Data.TaggedError('ProfessionalUnavailableError')<{
  readonly professionalId: string
  readonly reason: string
}> {}

export class OrderAlreadyClosedError extends Data.TaggedError('OrderAlreadyClosedError')<{
  readonly orderId: string
}> {}

export class CardDeclinedError extends Data.TaggedError('CardDeclinedError')<{
  readonly chargeId: string
  readonly gatewayCode: string
  readonly displayMessage: string
}> {}

export class EntityNotFoundError extends Data.TaggedError('EntityNotFoundError')<{
  readonly entity: string
  readonly id: string
}> {}

export class AuthorizationError extends Data.TaggedError('AuthorizationError')<{
  readonly userId: string
  readonly requiredRole: string
  readonly tenantId: string
}> {}

export type DomainError =
  | AppointmentConflictError
  | PlanNotActiveError
  | UsageLimitReachedError
  | ProfessionalUnavailableError
  | OrderAlreadyClosedError
  | CardDeclinedError
  | EntityNotFoundError
  | AuthorizationError
