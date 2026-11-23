import { Data } from 'effect'

export class SubscriptionNotActiveError extends Data.TaggedError('SubscriptionNotActiveError')<{
  readonly subscriptionId: string
  readonly currentStatus: string
}> {}

export class ChargeThresholdExceededError extends Data.TaggedError('ChargeThresholdExceededError')<{
  readonly subscriptionId: string
  readonly failedCount: number
  readonly threshold: number
}> {}
